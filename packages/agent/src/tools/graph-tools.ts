/**
 * 图谱查询工具（book_memory 投影的读端）：已读章节蒸馏出的实体名录、
 * 关系边与出处章。定位是检索的第一站——关系/身份/脉络类问题先查图
 * （零盲搜、带本版拼写与出处坐标），需要原文措辞或图未覆盖的内容再拿
 * 出处章去 read_chapter / search_book_text 取证。图是蒸馏摘要不是正文，
 * 引文永远回正文验证——这个分层写死在工具描述里。
 *
 * 剧透口径与 system prompt 的注入完全同源（thread.ts 的过滤规则）：
 * 叙事未读完 + fence 在 → 只见当前章之前的纪要；书线程 fence 缺失
 * （位置不明）→ 宁缺毋滥；confirmSpoiler 与正文工具同一逃生门。
 * 全局线程/跨书查询不设界：digest 只对读者到过的章存在（构建不变量），
 * 全集本身就是"读者已知"的上界。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import {
  type GraphEdge,
  mergeCharacterRegistry,
  mergeRelationGraph,
} from "../memory/chapter-digest";
import type { ChapterDigest, DigestCharacter, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId as resolveScopedBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";

const MAX_NAME_QUERIES = 8;
const MAX_EDGES_PER_ENTITY = 40;
const MAX_OVERVIEW_ENTITIES = 200;

/** 实体名匹配：本名/别名的不区分大小写含子串——读者的称呼常是简称。 */
function matchesEntity(entity: DigestCharacter, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const candidates = [entity.name, ...(entity.aliases ?? [])];
  return candidates.some((candidate) => {
    const hay = candidate.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
}

/** 实体的出场章列表：名字或任一别名出现在该章名录里。 */
function appearsIn(entity: DigestCharacter, digests: ChapterDigest[]): number[] {
  const names = new Set([entity.name, ...(entity.aliases ?? [])]);
  return digests
    .filter((digest) => digest.characters.some((character) => names.has(character.name)))
    .map((digest) => digest.chapterIndex)
    .sort((a, b) => a - b);
}

function edgesTouching(entity: DigestCharacter, edges: GraphEdge[]): GraphEdge[] {
  const names = new Set([entity.name, ...(entity.aliases ?? [])]);
  return edges.filter((edge) => names.has(edge.from) || names.has(edge.to));
}

export function buildGraphTools(
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState?: AgentTurnState,
): AgentTool[] {
  const queryBookGraph: AgentTool = {
    name: "query_book_graph",
    label: "Query book graph",
    description:
      'Query the book\'s knowledge graph — entities (characters for fiction, concepts for expository books), their aliases and one-line notes, relation edges, and the chapter where each was established, all distilled from THIS edition\'s finished chapters (spellings are this edition\'s, which your memory of the book is not). FIRST STOP for questions about who/what an entity is, how entities relate, or the story/argument so far — answer relation and identity questions from here instead of blind-searching prose. Every edge carries its provenance chapterIndex: to quote exact wording or verify detail, follow up with read_chapter/search_book_text AT that chapter. The graph is a distilled summary, not the text — verbatim quotes must always come from the book text, and anything the graph does not cover (imagery, specific arguments, scenes) still needs the text tools. Modes: pass "names" for full entity profiles (aliases, relations, appearance chapters); pass "chapterIndex" for that one chapter\'s summary and additions; pass neither for a whole-graph overview. bookId defaults to the current book.',
    parameters: Type.Object({
      names: Type.Optional(
        Type.Array(Type.String(), {
          minItems: 1,
          description: `Entity names or aliases to profile (any spelling the reader used; matching is fuzzy). Up to ${MAX_NAME_QUERIES}.`,
        }),
      ),
      chapterIndex: Type.Optional(
        Type.Number({
          minimum: 0,
          description: "Return this one chapter's digest: summary, entities, relations it established.",
        }),
      ),
      bookId: Type.Optional(Type.String()),
      confirmSpoiler: confirmSpoilerSchema,
    }),
    execute: async (_id, params) => {
      const raw = params as {
        names?: string[];
        chapterIndex?: unknown;
        bookId?: string;
        confirmSpoiler?: unknown;
      };
      const confirmSpoiler = spoilerGranted(raw.confirmSpoiler);
      const chapterQueryRaw =
        typeof raw.chapterIndex === "string" ? Number(raw.chapterIndex) : raw.chapterIndex;
      const chapterQuery =
        typeof chapterQueryRaw === "number" && Number.isInteger(chapterQueryRaw) && chapterQueryRaw >= 0
          ? chapterQueryRaw
          : undefined;
      const target = resolveScopedBookId(scope, raw.bookId);
      const digests = await deps.bookMemory.listDigests(target);
      if (!digests.length) {
        return textResult({
          graph: "empty",
          note: "No chapter digests exist for this book yet — the graph builds in the background as the reader progresses. Use get_toc / search_book_text / read_chapter instead.",
        });
      }
      // 剧透过滤：与 system prompt 注入同口径（见 runtime/thread.ts）。
      let visible = [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex);
      let fenceNote: string | undefined;
      if (!confirmSpoiler) {
        const book = await deps.library.getBook(target).catch(() => undefined);
        const narrativeUnfinished = book?.narrativity === "narrative" && book.status !== "finished";
        if (narrativeUnfinished && scope.kind === "book" && target === scope.bookId) {
          const fence = turnState?.spoilerFence;
          if (fence) {
            visible = visible.filter((digest) => digest.chapterIndex < fence.throughChapterIndex);
            fenceNote = `graph clamped to chapters before the reader's position (chapter index ${fence.throughChapterIndex})`;
          } else {
            // 位置不明的叙事书：图可能覆盖到读者位置之后（回读场景），宁缺毋滥。
            return textResult({
              graph: "unavailable",
              note: "The reader's position in this narrative book is unknown this turn, so the graph (which may reach beyond their position) is withheld. Ask where they are, or use search_book_text — it clamps safely.",
            });
          }
        }
      }
      if (!visible.length) {
        return textResult({
          graph: "empty",
          ...(fenceNote ? { note: `${fenceNote}; no digests fall within that range` } : {}),
        });
      }

      // 单章模式：该章的摘要 + 新增实体 + 该章确立的边。
      if (chapterQuery !== undefined) {
        const digest = visible.find((entry) => entry.chapterIndex === chapterQuery);
        if (!digest) {
          const exists = digests.some((entry) => entry.chapterIndex === chapterQuery);
          return textResult({
            graph: "miss",
            note: exists
              ? "That chapter's digest lies beyond the reader's position. If the reader explicitly asked for spoilers, retry with confirmSpoiler: true."
              : "That chapter has no digest (not read/digested yet, or out of range). read_chapter gives you the text directly.",
            ...(fenceNote ? { fence: fenceNote } : {}),
          });
        }
        return textResult({
          chapterIndex: digest.chapterIndex,
          summary: digest.summary,
          entities: digest.characters,
          relations: digest.relations,
          ...(fenceNote ? { fence: fenceNote } : {}),
        });
      }

      const registry = mergeCharacterRegistry(visible);
      const edges = mergeRelationGraph(visible);

      // 档案模式：每个命中实体的别名/注/出场章/关系邻域（带出处）。
      if (raw.names?.length) {
        const queries = raw.names.slice(0, MAX_NAME_QUERIES);
        const profiles: unknown[] = [];
        const misses: string[] = [];
        for (const query of queries) {
          const hits = registry.filter((entity) => matchesEntity(entity, query));
          if (!hits.length) {
            misses.push(query);
            continue;
          }
          for (const entity of hits) {
            profiles.push({
              name: entity.name,
              ...(entity.aliases?.length ? { aliases: entity.aliases } : {}),
              ...(entity.note ? { note: entity.note } : {}),
              appearsInChapters: appearsIn(entity, visible),
              relations: edgesTouching(entity, edges).slice(0, MAX_EDGES_PER_ENTITY),
            });
          }
        }
        return textResult({
          profiles,
          ...(misses.length
            ? {
                notFound: misses,
                note: "Unmatched names are not in the graph (minor figures and untracked terms are omitted at digest time) — search_book_text finds them in the prose.",
              }
            : {}),
          ...(fenceNote ? { fence: fenceNote } : {}),
        });
      }

      // 概览模式：名录（按出场章数排序）+ 边计数 + 覆盖范围。
      const mentions = new Map<string, number>();
      for (const digest of visible) {
        for (const character of digest.characters) {
          mentions.set(character.name, (mentions.get(character.name) ?? 0) + 1);
        }
      }
      const entities = registry
        .map((entity) => ({
          name: entity.name,
          ...(entity.aliases?.length ? { aliases: entity.aliases } : {}),
          chapters: mentions.get(entity.name) ?? 0,
        }))
        .sort((a, b) => b.chapters - a.chapters)
        .slice(0, MAX_OVERVIEW_ENTITIES);
      return textResult({
        chaptersDigested: visible.length,
        chapterRange: [visible[0]!.chapterIndex, visible[visible.length - 1]!.chapterIndex],
        entityCount: registry.length,
        edgeCount: edges.length,
        entities,
        note: "Pass names for full profiles with relations and provenance chapters.",
        ...(fenceNote ? { fence: fenceNote } : {}),
      });
    },
  };

  return [queryBookGraph];
}
