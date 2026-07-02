/**
 * 正文工具（doc §6 / §11.5 的读端）：目录、按章节读正文、全文检索。
 * 章节可能很长，read_chapter 按 part 窗口化返回，agent 需要更多就翻 part ——
 * 这本身就是"agent 迭代检索替代向量召回"的机制之一。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

const CHAPTER_PART_CHARS = 4000;

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
      "Get a book's table of contents (chapter index + title). Empty when the book's text has not been extracted. bookId defaults to the current book.",
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
      "Read one chapter's actual text, windowed into parts. Start at part 0; the result tells you totalParts — request further parts when you need more. bookId defaults to the current book.",
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
      "Full-text search inside the books' actual prose. Try several phrasings if the first query misses — recall depends on wording. bookId defaults to the current book; omit bookId in the global thread to search the whole shelf.",
    parameters: Type.Object({
      query: Type.String(),
      bookId: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const { query, bookId } = params as { query: string; bookId?: string };
      const target = bookId ?? defaultBookId;
      return textResult(
        await deps.bookText.searchText({ query, bookId: target as Id | undefined, limit: 8 }),
      );
    },
  };

  return [getToc, readChapter, searchBookText];
}
