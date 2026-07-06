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
import { textResult } from "./tool-result";

const CHAPTER_PART_CHARS = 12000;

export function buildBookTextTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const defaultBookId = scope.kind === "book" ? scope.bookId : undefined;

  const resolveBookId = (raw?: string): Id => {
    const target = (raw ?? defaultBookId) as Id | undefined;
    if (!target) throw new Error("bookId is required in the global thread");
    return target;
  };

  const getToc: AgentTool = {
    name: "get_toc",
    label: "Table of contents",
    description:
      "Get a book's table of contents (chapter index, title, and text length in chars — one read_chapter part covers 12000 chars, so you can budget how many parts a chapter needs). Empty when the book's text has not been extracted. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      return textResult(await deps.bookText.getToc(resolveBookId(bookId)));
    },
  };

  const readChapter: AgentTool = {
    name: "read_chapter",
    label: "Read chapter",
    description:
      "Read one chapter's actual text, windowed into parts of 12000 chars (most chapters fit in one part). Start at part 0; the result tells you totalParts. Need several chapters? Issue the read_chapter calls together in one batch — they run in parallel. bookId defaults to the current book.",
    parameters: Type.Object({
      chapterIndex: Type.Number({ description: "Chapter index from get_toc" }),
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
      "Full-text search inside the books' actual prose. Pass SEVERAL phrasings/synonyms in `queries` in this ONE call (results are merged and deduped) instead of retrying one query at a time — recall depends on wording and each retry costs a whole round trip. Exact matches come first; token-level fallback matches are marked \"partial\". Each hit reports the read_chapter `part` it falls in, so you can jump straight to it. bookId defaults to the current book; omit bookId in the global thread to search the whole shelf.",
    parameters: Type.Object({
      queries: Type.Array(Type.String(), {
        minItems: 1,
        maxItems: 5,
        description: "1-5 query variants, searched together",
      }),
      bookId: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const { queries, bookId } = params as { queries: string[]; bookId?: string };
      const target = bookId ?? defaultBookId;
      const hits = await deps.bookText.searchText({
        queries,
        bookId: target as Id | undefined,
        limit: 16,
      });
      return textResult({
        totalHits: hits.length,
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
