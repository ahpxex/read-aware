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

const CHAPTER_PART_CHARS = 12000;

export function buildBookTextTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const defaultBookId = scope.kind === "book" ? scope.bookId : undefined;

  const resolveBookId = (raw?: string): Id => resolveScopedBookId(scope, raw);

  const getToc: AgentTool = {
    name: "get_toc",
    label: "Table of contents",
    description:
      "Get a book's table of contents. Each entry carries chapterIndex (what read_chapter takes) AND chapterNumber (how the reader counts, 1-based): when the reader says \"chapter N\", find the entry whose chapterNumber is N and pass its chapterIndex — never do the arithmetic yourself. chars = text length (one read_chapter part covers 12000 chars). A TOC does not prove whether a topic appears in the prose: if the reader asks you to check coverage, continue with search_book_text or read_chapter in this same turn instead of offering to look later. Empty when the book's text has not been extracted. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      const toc = await deps.bookText.getToc(resolveBookId(bookId));
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
    }),
    execute: async (_id, params) => {
      const { chapterIndex, part = 0, bookId } = params as {
        chapterIndex: number;
        part?: number;
        bookId?: string;
      };
      const target = resolveBookId(bookId);
      const text = await deps.bookText.getChapterText(target, chapterIndex);
      if (text === undefined) {
        throw new Error(`chapter ${chapterIndex} of ${target} is not extracted or does not exist`);
      }
      const totalParts = Math.max(1, Math.ceil(text.length / CHAPTER_PART_CHARS));
      const window = Math.min(Math.max(0, part), totalParts - 1);
      return textResult({
        bookId: target,
        chapterIndex,
        part: window,
        totalParts,
        text: text.slice(window * CHAPTER_PART_CHARS, (window + 1) * CHAPTER_PART_CHARS),
      });
    },
  };

  const searchBookText: AgentTool = {
    name: "search_book_text",
    label: "Search book text",
    description:
      "Full-text search inside the books' actual prose. Pass SEVERAL phrasings/synonyms in `queries` in this ONE call (results are merged and deduped) instead of retrying one query at a time — recall depends on wording and each retry costs a whole round trip. Exact matches come first; token-level fallback matches are marked \"partial\". Each hit reports the read_chapter `part` it falls in, so you can jump straight to it. throughChapterIndex is an inclusive chapter ceiling, but it cannot hide unread text later inside that same chapter. When a narrative book has cursor.visible_text and the reader did not request spoilers, NEVER search the current or later chapters, even to gather or verify clues the reader has already seen; use visible_text for the current passage and search only earlier chapters. bookId defaults to the current book; omit bookId in the global thread to search the whole shelf.",
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
    }),
    execute: async (_id, params) => {
      const { queries: rawQueries, bookId, throughChapterIndex } = params as {
        queries: string[];
        bookId?: string;
        throughChapterIndex?: number;
      };
      // 变体轰炸（25 个查询）就地截断，别让 schema 报错烧掉一轮往返
      const queries = rawQueries.slice(0, 12);
      const target = normalizeBookIdParam(bookId) ?? defaultBookId;
      if (throughChapterIndex !== undefined && !target) {
        throw new Error("throughChapterIndex requires bookId in the global thread");
      }
      const hits = await deps.bookText.searchText({
        queries,
        bookId: target as Id | undefined,
        throughChapterIndex,
        limit: 16,
      });
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
