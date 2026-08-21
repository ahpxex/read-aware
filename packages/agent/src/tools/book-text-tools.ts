/**
 * 正文工具（doc §6 / §11.5 的读端）：目录、按章节读正文、全文检索。
 * 章节按 part 窗口化返回（12k 字符 —— 绝大多数章节一片读完），检索一次收
 * 多个查询变体并回报命中所在的 part —— 都是为了压掉模型的额外往返：
 * 换词重试和逐片翻页每次都是一个完整的 LLM round trip。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam, resolveBookId as resolveScopedBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";

const CHAPTER_PART_CHARS = 12000;

export const confirmSpoilerSchema = Type.Optional(
  Type.Boolean({
    description:
      "Set true ONLY when the reader explicitly asked for spoilers in this conversation; lifts the narrative reading-position fence for this call. NEVER set it to widen search coverage, on expository/technical books (they have no fence), or 'just in case' — setting it without the reader's explicit grant is a policy violation.",
  }),
);

/**
 * 授权参数归一化：模型偶发把布尔发成字符串。宽松 truthy 判断会让
 * "false" 字符串穿透围栏——只认 true 与 "true"，其余一律视为未授权。
 */
export function spoilerGranted(value: unknown): boolean {
  return value === true || value === "true";
}

/** confirmSpoiler is capability use, not authorization creation. */
export function assertSpoilerPermission(
  confirmSpoiler: boolean,
  turnState: AgentTurnState | undefined,
  targetIsCurrentBook: boolean,
): void {
  if (!confirmSpoiler || !turnState || !targetIsCurrentBook) return;
  if (turnState.spoilerPermissionGranted) return;
  turnState.spoilerPermissionDenied = true;
  throw new Error(
    "confirmSpoiler was rejected because the reader has not explicitly granted spoiler permission. Stay within the reading boundary or ask the reader with ask_user; the tool argument cannot grant itself permission.",
  );
}

/** 数字参数归一化（模型偶发发成字符串数字）；非数字返回 undefined。 */
function asIndex(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
}

export function buildBookTextTools(
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState?: AgentTurnState,
): AgentTool[] {
  const defaultBookId = scope.kind === "book" ? scope.bookId : undefined;

  const resolveBookId = (raw?: string): Id => resolveScopedBookId(scope, raw);

  /** 围栏只作用于当前书（围栏本身仅在书线程被 thread 设置）。 */
  const fenceFor = (target: Id | undefined) =>
    scope.kind === "book" && target === scope.bookId ? turnState?.spoilerFence : undefined;

  const getToc: AgentTool = {
    name: "get_toc",
    label: "Table of contents",
    description:
      "Get a book's table of contents. Each entry carries chapterIndex (what read_chapter takes) AND chapterNumber (how the reader counts, 1-based): when the reader says \"chapter N\", find the entry whose chapterNumber is N and pass its chapterIndex — never do the arithmetic yourself. chars = text length (one read_chapter part covers 12000 chars). A TOC does not prove whether a topic appears in the prose: if the reader asks you to check coverage, continue with search_book_text or read_chapter in this same turn instead of offering to look later. An empty result carries textStatus: \"textless\" means the book has no text layer at all (image-only scan — do not retry, tell the reader honestly), \"unextracted\" means extraction has not finished yet. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      const target = resolveBookId(bookId);
      const toc = await deps.bookText.getToc(target);
      // 空目录要说真话：纯图扫描版（无文字层）与"还没抽取"是两种事实，
      // 前者重试无益，模型该向读者如实解释，而不是对着空数组瞎猜。
      if (toc.length === 0 && deps.bookText.getTextStatus) {
        const status = await deps.bookText.getTextStatus(target).catch(() => undefined);
        if (status === "textless") {
          return textResult({
            chapters: [],
            textStatus: "textless",
            note: "This book has no extractable text layer (likely an image-only scan). Book-text tools cannot read it; be honest with the reader about this limitation instead of retrying.",
          });
        }
        if (status === "unextracted") {
          return textResult({
            chapters: [],
            textStatus: "unextracted",
            note: "This book's text has not been fully extracted yet. Extraction has been started (or resumes) in the background and also runs while the book is open in the reader; for a long scanned PDF it can take a few minutes. Tell the reader, and try again later in the conversation rather than retrying immediately.",
          });
        }
      }
      // hrefs 是运行时的反查键（阅读位置 → 章节），对模型是纯噪音。
      // chapterNumber 让"第 N 章 → index"从心算变成查表——off-by-one 的根除。
      return textResult(
        toc.map(({ index, title, chars }) => ({
          chapterIndex: index,
          chapterNumber: index + 1,
          title,
          chars,
        })),
      );
    },
  };

  const readChapter: AgentTool = {
    name: "read_chapter",
    label: "Read chapter",
    description:
      "Read one chapter's actual text, windowed into parts of 12000 chars (most chapters fit in one part). Start at part 0; the result tells you totalParts. IMPORTANT: this returns the chapter's full text and cannot stop at the newest reading cursor. When a narrative book has cursor.visible_text and the reader did not request spoilers, NEVER call read_chapter on the current chapter, even to gather or verify clues the reader has already seen; the cursor already contains the safe current material. After reading an allowed chapter, complete the reader's requested answer in this turn. Need several chapters? Issue the read_chapter calls together in one batch — they run in parallel. bookId defaults to the current book.",
    parameters: Type.Object({
      chapterIndex: Type.Number({
        description:
          "0-based chapterIndex copied from the get_toc entry (match the reader's \"chapter N\" against get_toc's chapterNumber field — do not compute N-1 yourself). Name the chapter to the reader by its chapterNumber and title.",
      }),
      part: Type.Optional(Type.Number({ description: "Window index, default 0" })),
      bookId: Type.Optional(Type.String()),
      confirmSpoiler: confirmSpoilerSchema,
    }),
    execute: async (_id, params) => {
      const raw = params as {
        chapterIndex: unknown;
        part?: unknown;
        bookId?: string;
        confirmSpoiler?: unknown;
      };
      const chapterIndex = asIndex(raw.chapterIndex);
      if (chapterIndex === undefined) {
        throw new Error("chapterIndex must be a non-negative integer");
      }
      const part = asIndex(raw.part) ?? 0;
      const bookId = raw.bookId;
      const confirmSpoiler = spoilerGranted(raw.confirmSpoiler);
      const target = resolveBookId(bookId);
      const fence = fenceFor(target);
      assertSpoilerPermission(confirmSpoiler, turnState, target === defaultBookId);
      if (fence && chapterIndex > fence.throughChapterIndex && !confirmSpoiler) {
        throw new Error(
          `chapter ${chapterIndex} is beyond the reader's position or viewport boundary (reader chapter index ${fence.readerChapterIndex ?? fence.throughChapterIndex}) in this narrative book. If the reader explicitly asked for spoilers this turn, retry with confirmSpoiler: true; otherwise stay within the boundary.`,
        );
      }
      const text = await deps.bookText.getChapterText(target, chapterIndex);
      if (text === undefined) {
        throw new Error(`chapter ${chapterIndex} of ${target} is not extracted or does not exist`);
      }
      const totalParts = Math.max(1, Math.ceil(text.length / CHAPTER_PART_CHARS));
      const window = Math.min(Math.max(0, part), totalParts - 1);
      const returnedText = text.slice(
        window * CHAPTER_PART_CHARS,
        (window + 1) * CHAPTER_PART_CHARS,
      );
      if (turnState) {
        turnState.evidenceTexts.push(returnedText);
        if (confirmSpoiler && target === defaultBookId) turnState.spoilerGranted = true;
      }
      return textResult({
        bookId: target,
        chapterIndex,
        part: window,
        totalParts,
        text: returnedText,
      });
    },
  };

  const searchBookText: AgentTool = {
    name: "search_book_text",
    label: "Search book text",
    description:
      "Full-text search inside the books' actual prose. For who/what/relation/arc questions, query_book_graph first — it answers those directly and names the provenance chapters, turning this from a blind sweep into a targeted fetch; use THIS tool for exact wording, quotes, and anything the graph does not carry. Pass SEVERAL phrasings/synonyms in `queries` in this ONE call (results are merged and deduped) instead of retrying one query at a time — recall depends on wording and each retry costs a whole round trip. Exact matches come first; token-level fallback matches are marked \"partial\". Each hit reports the read_chapter `part` it falls in, so you can jump straight to it. throughChapterIndex is an inclusive chapter ceiling, but it cannot hide unread text later inside that same chapter. When a narrative book has cursor.visible_text and the reader did not request spoilers, NEVER search the current or later chapters, even to gather or verify clues the reader has already seen; use visible_text for the current passage and search only earlier chapters. bookId defaults to the current book; omit bookId in the global thread to search the whole shelf.",
    parameters: Type.Object({
      queries: Type.Array(Type.String(), {
        minItems: 1,
        description:
          "Query variants, searched together. 2-5 focused variants beat a broad sweep; anything past 12 is ignored.",
      }),
      bookId: Type.Optional(Type.String()),
      throughChapterIndex: Type.Optional(
        Type.Number({
          minimum: 0,
          description:
            "Inclusive last chapter to search. For an unfinished narrative chapter, use the previous chapter as the ceiling and rely on reading_cursor.visible_text for the current passage; explicit spoiler requests may use later chapters.",
        }),
      ),
      confirmSpoiler: confirmSpoilerSchema,
    }),
    execute: async (_id, params) => {
      const { queries: rawQueries, bookId, ...rest } = params as {
        queries: string[];
        bookId?: string;
        throughChapterIndex?: unknown;
        confirmSpoiler?: unknown;
      };
      const confirmSpoiler = spoilerGranted(rest.confirmSpoiler);
      let throughChapterIndex = asIndex(rest.throughChapterIndex);
      // 变体轰炸（25 个查询）就地截断，别让 schema 报错烧掉一轮往返
      const queries = rawQueries.slice(0, 12);
      const target = normalizeBookIdParam(bookId) ?? defaultBookId;
      assertSpoilerPermission(confirmSpoiler, turnState, target === defaultBookId);
      if (throughChapterIndex !== undefined && !target) {
        throw new Error("throughChapterIndex requires bookId in the global thread");
      }
      // 围栏：未获剧透授权的检索静默收边到读者位置——结果按构造即安全，不烧往返
      const fence = fenceFor(target as Id | undefined);
      if (fence && !confirmSpoiler) {
        throughChapterIndex = Math.min(
          throughChapterIndex ?? fence.throughChapterIndex,
          fence.throughChapterIndex,
        );
      }
      const hits = await deps.bookText.searchText({
        queries,
        bookId: target as Id | undefined,
        throughChapterIndex,
        limit: 16,
      });
      if (turnState) {
        turnState.evidenceTexts.push(...hits.map((hit) => hit.snippet));
        if (confirmSpoiler && target === defaultBookId) turnState.spoilerGranted = true;
      }
      return textResult({
        totalHits: hits.length,
        ...(throughChapterIndex !== undefined ? { throughChapterIndex } : {}),
        hits: hits.map((hit) => ({
          bookId: hit.bookId,
          chapterIndex: hit.chapterIndex,
          chapterTitle: hit.chapterTitle,
          part: Math.floor(hit.offset / CHAPTER_PART_CHARS),
          match: hit.match,
          snippet: hit.snippet,
        })),
      });
    },
  };

  return [getToc, readChapter, searchBookText];
}
