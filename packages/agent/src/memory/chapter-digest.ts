/**
 * 章节读毕提炼（book_memory 投影 v1 的写管道）：读者每读完一章，后台在
 * `fast` 档位上从该章文本提炼一份纪要——摘要 + 人物名录（含别名/称呼）。
 *
 * 这是"给每本书造它自己的人物表"：大多数书没有前置角色表，而 flash 级
 * 模型凭预训练记忆最容易在译名拼写和"谁说了什么"上翻车。名录严格取自
 * 本书文本、按本书拼写，注入 system prompt 后模型照抄即可，不必猜。
 *
 * 与逐轮记忆提炼同一失败哲学：任何失败都静默跳过该章，绝不冒泡；
 * 产物经 BookMemoryPort 落成 book.chapterDigested 事件（LLM 产物不可
 * 确定性重算，入事件流才可跨设备同步、可重放）。
 */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type {
  BookMemoryPort,
  BookTextPort,
  ChapterDigest,
  DigestCharacter,
  DigestRelation,
} from "../ports";

/** 提炼管线版本：升版意味着提示词/口径换代，旧摘要整体重算。v2 加关系边。 */
export const DIGEST_VERSION = 2;

/** 交给 fast 模型的单章正文上限（超长章节截断——纪要不需要每个字）。 */
const CHAPTER_TEXT_BUDGET = 20_000;
/** 单章人物名录上限，防止名录膨胀成人名词典。 */
const MAX_CHARACTERS = 12;
/** 单章关系边上限——只要该章确立/揭示的，不是全书关系的重述。 */
const MAX_RELATIONS = 12;

function buildDigestPrompt(known: DigestCharacter[]): string {
  const knownBlock = known.length
    ? `Characters already known from earlier chapters (merge into these — reuse the EXACT same "name" when the same person appears again, adding any new alias):\n${known
        .map(
          (character) =>
            `- ${character.name}${character.aliases?.length ? ` (${character.aliases.join(", ")})` : ""}`,
        )
        .join("\n")}`
    : "Characters already known from earlier chapters: (none yet)";
  return `You maintain a reading companion's per-book memory. Digest ONE chapter of a book from its verbatim text.

Hard rules:
- Use ONLY the chapter text below. Nothing from your general knowledge of this work — other editions translate names differently, and your memory of the plot may be wrong for THIS edition.
- Copy every name and alias EXACTLY as this text spells it, character for character. Never normalize a name to a spelling you remember from elsewhere.
- "characters": people who appear or are directly discussed in THIS chapter (at most ${MAX_CHARACTERS}). "note" is one short clause about who they are / what this chapter reveals about them — grounded in this chapter only.
- "relations": relationships this chapter ESTABLISHES or REVEALS between characters (at most ${MAX_RELATIONS}) — kinship, marriage/betrothal, service, rivalry, mentorship. "from"/"to" must reuse exact "name" values (from this chapter's list or the known list). "kind" is a short noun in the chapter's language, read from "from" toward "to" (e.g. {"from": "甲", "kind": "父亲", "to": "乙"} means 甲 is 乙's father). Do NOT restate relationships already obvious from earlier chapters unless this chapter adds something; do NOT invent relationships from your general knowledge of the work.
- "summary": 1-3 sentences on what happens in this chapter, in the same language as the chapter text. No foreshadowing, no interpretation imported from outside the text.

${knownBlock}

Output STRICT JSON only, no prose, no code fences:
{"summary": "...", "characters": [{"name": "...", "aliases": ["..."], "note": "..."}], "relations": [{"from": "...", "kind": "...", "to": "...", "note": "..."}]}`;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function normalizeCharacters(raw: unknown): DigestCharacter[] {
  if (!Array.isArray(raw)) return [];
  const characters: DigestCharacter[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_CHARACTERS)) {
    if (!item || typeof item !== "object") continue;
    const { name, aliases, note } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    if (seen.has(name.trim())) continue;
    seen.add(name.trim());
    const cleanAliases = Array.isArray(aliases)
      ? aliases
          .filter((alias): alias is string => typeof alias === "string" && Boolean(alias.trim()))
          .map((alias) => alias.trim())
      : [];
    characters.push({
      name: name.trim(),
      ...(cleanAliases.length ? { aliases: cleanAliases } : {}),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    });
  }
  return characters;
}

function normalizeRelations(raw: unknown, characterNames: Set<string>): DigestRelation[] {
  if (!Array.isArray(raw)) return [];
  const relations: DigestRelation[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_RELATIONS)) {
    if (!item || typeof item !== "object") continue;
    const { from, kind, to, note } = item as Record<string, unknown>;
    if (typeof from !== "string" || !from.trim()) continue;
    if (typeof kind !== "string" || !kind.trim()) continue;
    if (typeof to !== "string" || !to.trim()) continue;
    // 端点必须是已知人名——挂空边比缺边更毒（下游会当真引用）。
    if (!characterNames.has(from.trim()) || !characterNames.has(to.trim())) continue;
    if (from.trim() === to.trim()) continue;
    const key = `${from.trim()}|${kind.trim()}|${to.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({
      from: from.trim(),
      kind: kind.trim(),
      to: to.trim(),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    });
  }
  return relations;
}

export interface ExtractChapterDigestInput {
  complete: CompleteFn;
  model: Model<Api>;
  chapterIndex: number;
  chapterHref?: string;
  chapterTitle?: string;
  chapterText: string;
  /** 已读章节里累计的人物名录——别名归并的锚点。 */
  knownCharacters: DigestCharacter[];
}

/** 提炼单章；任何失败返回 undefined（调用方跳过该章，下次再试）。 */
export async function extractChapterDigest(
  input: ExtractChapterDigestInput,
): Promise<ChapterDigest | undefined> {
  const text = input.chapterText.trim();
  if (!text) return undefined;
  let message: AssistantMessage;
  try {
    message = await input.complete(input.model, {
      systemPrompt: buildDigestPrompt(input.knownCharacters),
      messages: [
        {
          role: "user",
          content: `Chapter #${input.chapterIndex}${
            input.chapterTitle ? ` "${input.chapterTitle}"` : ""
          }:\n\n${text.slice(0, CHAPTER_TEXT_BUDGET)}`,
          timestamp: Date.now(),
        },
      ],
    });
  } catch {
    return undefined;
  }
  const parsed = parseJson(extractText(message));
  if (!parsed || typeof parsed !== "object") return undefined;
  const { summary, characters, relations } = parsed as Record<string, unknown>;
  if (typeof summary !== "string" || !summary.trim()) return undefined;
  const normalizedCharacters = normalizeCharacters(characters);
  // 关系端点允许引用本章名录或此前已知的人物——跨章关系（本章才揭示
  // 两个旧角色的关联）是常态。
  const knownNames = new Set([
    ...normalizedCharacters.map((character) => character.name),
    ...input.knownCharacters.map((character) => character.name),
  ]);
  return {
    chapterIndex: input.chapterIndex,
    ...(input.chapterHref ? { chapterHref: input.chapterHref } : {}),
    summary: summary.trim(),
    characters: normalizedCharacters,
    relations: normalizeRelations(relations, knownNames),
    digestVersion: DIGEST_VERSION,
  };
}

/** 叙事图的一条边，带确立出处（章节 index）——剧透切片的钥匙。 */
export interface GraphEdge extends DigestRelation {
  establishedAt: number;
}

/**
 * 跨章归并关系边：端点先过实体归并（"米嘉→费奥多尔"与
 * "德米特里·费奥多罗维奇→费奥多尔·巴甫洛维奇"是同一条边），再按
 * (from, kind, to) 去重——保留最早确立的出处戳，note 取最新章的。
 */
export function mergeRelationGraph(digests: ChapterDigest[]): GraphEdge[] {
  const resolution = resolveEntityNames(digests);
  const canonical = (name: string) => resolution.get(name) ?? name;
  const byKey = new Map<string, GraphEdge>();
  for (const digest of [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex)) {
    for (const relation of digest.relations ?? []) {
      const from = canonical(relation.from);
      const to = canonical(relation.to);
      if (from === to) continue;
      const key = `${from}|${relation.kind}|${to}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          from,
          kind: relation.kind,
          to,
          ...(relation.note ? { note: relation.note } : {}),
          establishedAt: digest.chapterIndex,
        });
        continue;
      }
      if (relation.note) byKey.set(key, { ...existing, note: relation.note });
    }
  }
  return [...byKey.values()];
}

/**
 * 实体归并（碎片消解）：同一人物在不同章被写成"米嘉"或
 * "德米特里·费奥多罗维奇·卡拉马佐夫"——但纪要自带别名证据，
 * name 与 aliases 的共现即等价关系，跨章累积后用并查集把碎片
 * 缩成一个实体。返回 任意名字 → 规范名 的映射；规范名取
 * 提及章数最多者（并列取更长的全名）。
 *
 * 防误并：同一章的纪要里并列出现的两个 name 是模型明确区分的两个人，
 * 绝不允许被别名证据合并——family surname 之类的共享别名（同章内
 * 指向多个 name 的歧义别名）直接作废，不参与任何合并。
 */
export function resolveEntityNames(digests: ChapterDigest[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };

  const ordered = [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex);
  // 1) 收集互斥对（同章并列的 name）与歧义别名（同章指向多个 name）。
  const distinctPairs = new Set<string>();
  const ambiguousAliases = new Set<string>();
  for (const digest of ordered) {
    const names = digest.characters.map((character) => character.name);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        distinctPairs.add(`${names[i]} ${names[j]}`);
        distinctPairs.add(`${names[j]} ${names[i]}`);
      }
    }
    const aliasOwners = new Map<string, string>();
    for (const character of digest.characters) {
      for (const alias of character.aliases ?? []) {
        const owner = aliasOwners.get(alias);
        if (owner !== undefined && owner !== character.name) ambiguousAliases.add(alias);
        aliasOwners.set(alias, character.name);
      }
    }
  }
  const conflicts = (a: string, b: string) => {
    // 并查集合并前检查：两簇的任意成员在同章并列过 → 不是同一人。
    const membersOf = (root: string) =>
      [...parent.keys()].filter((name) => find(name) === root);
    const left = membersOf(find(a));
    const right = membersOf(find(b));
    return left.some((x) => right.some((y) => distinctPairs.has(`${x} ${y}`)));
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb || conflicts(ra, rb)) return;
    parent.set(ra, rb);
  };
  const ensure = (name: string) => {
    if (!parent.has(name)) parent.set(name, name);
  };

  // 2) 别名证据驱动合并：字符串相等（name↔name 跨章天然同簇）之外，
  //    name 与 alias 的共现即等价——除非冲突检查拦下。
  for (const digest of ordered) {
    for (const character of digest.characters) {
      ensure(character.name);
      for (const alias of character.aliases ?? []) {
        if (ambiguousAliases.has(alias)) continue;
        ensure(alias);
        union(alias, character.name);
      }
    }
  }

  // 3) 规范名：簇内提及章数最多的名字，并列取更长者。
  const mentions = new Map<string, number>();
  for (const digest of ordered) {
    for (const character of digest.characters) {
      mentions.set(character.name, (mentions.get(character.name) ?? 0) + 1);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const name of parent.keys()) {
    const root = find(name);
    clusters.set(root, [...(clusters.get(root) ?? []), name]);
  }
  const resolution = new Map<string, string>();
  for (const members of clusters.values()) {
    const canonical = [...members].sort(
      (a, b) =>
        (mentions.get(b) ?? 0) - (mentions.get(a) ?? 0) ||
        b.length - a.length ||
        a.localeCompare(b),
    )[0]!;
    for (const member of members) resolution.set(member, canonical);
  }
  return resolution;
}

/** 跨章节归并人物名录：实体归并 + 别名求并、note 取最新章的。 */
export function mergeCharacterRegistry(digests: ChapterDigest[]): DigestCharacter[] {
  const resolution = resolveEntityNames(digests);
  const canonical = (name: string) => resolution.get(name) ?? name;
  const byName = new Map<string, DigestCharacter>();
  for (const digest of [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex)) {
    for (const character of digest.characters) {
      const key = canonical(character.name);
      const incomingAliases = [character.name, ...(character.aliases ?? [])].filter(
        (alias) => alias !== key,
      );
      const existing = byName.get(key);
      const aliases = new Set([...(existing?.aliases ?? []), ...incomingAliases]);
      byName.set(key, {
        name: key,
        ...(aliases.size ? { aliases: [...aliases] } : {}),
        ...(character.note
          ? { note: character.note }
          : existing?.note
            ? { note: existing.note }
            : {}),
      });
    }
  }
  return [...byName.values()];
}

export interface DigestMissingChaptersInput {
  bookText: Pick<BookTextPort, "getToc" | "getChapterText">;
  bookMemory: BookMemoryPort;
  complete: CompleteFn;
  model: Model<Api>;
  bookId: Id;
  /** 只提炼严格小于该 index 的章节——当前章还没读完，不属于"读毕"。 */
  beforeChapterIndex: number;
  /** 单次调用的章节预算（后台管线按 idle 节拍分摊成本）。 */
  maxChapters?: number;
}

/**
 * 补齐缺失（或版本过期）的章节纪要，按序逐章、每次最多 maxChapters 章。
 * 返回本次实际提炼的章数；单章失败跳过不中断。
 */
export async function digestMissingChapters(
  input: DigestMissingChaptersInput,
): Promise<number> {
  const max = input.maxChapters ?? 2;
  if (max <= 0 || input.beforeChapterIndex <= 0) return 0;
  const [toc, existing] = await Promise.all([
    input.bookText.getToc(input.bookId),
    input.bookMemory.listDigests(input.bookId),
  ]);
  const current = new Map(
    existing
      .filter((digest) => digest.digestVersion >= DIGEST_VERSION)
      .map((digest) => [digest.chapterIndex, digest]),
  );
  let digested = 0;
  const ceiling = Math.min(input.beforeChapterIndex, toc.length);
  for (let index = 0; index < ceiling && digested < max; index++) {
    if (current.has(index)) continue;
    const chapterText = await input.bookText.getChapterText(input.bookId, index);
    if (!chapterText?.trim()) continue;
    const digest = await extractChapterDigest({
      complete: input.complete,
      model: input.model,
      chapterIndex: index,
      chapterHref: toc[index]?.hrefs?.[0],
      chapterTitle: toc[index]?.title,
      chapterText,
      knownCharacters: mergeCharacterRegistry([...current.values()]),
    });
    if (!digest) continue;
    await input.bookMemory.saveDigest(input.bookId, digest);
    current.set(index, digest);
    digested += 1;
  }
  return digested;
}
