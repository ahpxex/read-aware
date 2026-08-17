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
import type { BookMemoryPort, BookTextPort, ChapterDigest, DigestCharacter } from "../ports";

/** 提炼管线版本：升版意味着提示词/口径换代，旧摘要整体重算。 */
export const DIGEST_VERSION = 1;

/** 交给 fast 模型的单章正文上限（超长章节截断——纪要不需要每个字）。 */
const CHAPTER_TEXT_BUDGET = 20_000;
/** 单章人物名录上限，防止名录膨胀成人名词典。 */
const MAX_CHARACTERS = 12;

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
- "summary": 1-3 sentences on what happens in this chapter, in the same language as the chapter text. No foreshadowing, no interpretation imported from outside the text.

${knownBlock}

Output STRICT JSON only, no prose, no code fences:
{"summary": "...", "characters": [{"name": "...", "aliases": ["..."], "note": "..."}]}`;
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
  const { summary, characters } = parsed as Record<string, unknown>;
  if (typeof summary !== "string" || !summary.trim()) return undefined;
  return {
    chapterIndex: input.chapterIndex,
    ...(input.chapterHref ? { chapterHref: input.chapterHref } : {}),
    summary: summary.trim(),
    characters: normalizeCharacters(characters),
    digestVersion: DIGEST_VERSION,
  };
}

/** 跨章节归并人物名录：同名合并、别名求并、note 取最新章的。 */
export function mergeCharacterRegistry(digests: ChapterDigest[]): DigestCharacter[] {
  const byName = new Map<string, DigestCharacter>();
  for (const digest of [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex)) {
    for (const character of digest.characters) {
      const existing = byName.get(character.name);
      if (!existing) {
        byName.set(character.name, { ...character });
        continue;
      }
      const aliases = new Set([...(existing.aliases ?? []), ...(character.aliases ?? [])]);
      byName.set(character.name, {
        name: character.name,
        ...(aliases.size ? { aliases: [...aliases] } : {}),
        ...(character.note ? { note: character.note } : existing.note ? { note: existing.note } : {}),
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
