/**
 * 第一批检索工具（doc §6 的子集）：全部是端口之上的本地函数，不走网络。
 * search_memory / remember / search_conversation 等记忆工具属于 Phase 2，
 * 落地时加在这里的兄弟模块里。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, type Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";
import { bool, int, nullable, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import {
  BOOK_LIST_DEFAULT_LIMIT,
  BOOK_LIST_MAX_LIMIT,
  BOOK_LIST_SORTS,
  queryBookList,
  type BookListQuery,
} from "./book-list-query";

export function buildThreadTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const defaultBookId = scope.kind === "book" ? scope.bookId : undefined;

  const listBooks: AgentTool = {
    name: "list_books",
    label: "List books",
    description:
      "List the user's shelf: {books,total,nextOffset}. Each book has title, author, format, collection, reading progress and status, fileSize in bytes, annotationCount, and fileOnDevice. fileOnDevice=false means only the shelf entry is here (title, cover, progress) and the file is not on this device; whether it can still be fetched is answered by check_book_files, so never call such a book lost or deletable from this field alone. Two entries can be the same book imported twice: entries of one format with the same fileSize are likely one file, so say so before treating either as a leftover (get_book_overview adds the original fileName). Filter instead of scanning the whole shelf (search, status, format, starred, collectionId, fileOnDevice, hasAnnotations); follow nextOffset with the same filters and sort. Books imported from a folder carry sourcePath (the picked folder's name plus the path below it, e.g. Books/Sci-fi/Dune.epub): use it to group them by their original folders with manage_collection when the user asks.",
    parameters: obj({
      search: opt(
        str({ maxLength: 200, description: "Case-insensitive part of the title, author or original file name" }),
      ),
      status: opt(oneOf(["unread", "reading", "finished"])),
      format: opt(oneOf(["epub", "mobi", "azw3", "fb2", "cbz", "cbr", "txt", "html", "pdf", "virtual"])),
      starred: opt(bool()),
      collectionId: opt(
        nullable(str({ minLength: 1, maxLength: 256 }), {
          description: "A collection id from list_collections, or null for books in no collection",
        }),
      ),
      fileOnDevice: opt(bool({ description: "false: books whose file is not on this device" })),
      hasAnnotations: opt(bool()),
      sort: opt(
        oneOf(BOOK_LIST_SORTS, {
          description:
            "recent = last opened first; added = newest first; progress and size = largest first. Omit for shelf order.",
        }),
      ),
      offset: opt(int({ minimum: 0 })),
      limit: opt(int({ minimum: 1, maximum: BOOK_LIST_MAX_LIMIT, description: `Default ${BOOK_LIST_DEFAULT_LIMIT}` })),
    }),
    execute: async (_id, params) => {
      const page = queryBookList(await deps.library.listBooks(), params as BookListQuery);
      // The file name mostly repeats the title and is the longest field on a large shelf;
      // search still matches it, and get_book_overview returns it.
      return textResult({ ...page, books: page.books.map(({ fileName: _fileName, ...book }) => book) });
    },
  };

  const getBookOverview: AgentTool = {
    name: "get_book_overview",
    label: "Book overview",
    description:
      scope.kind === "book"
        ? 'Get one book\'s metadata and reading progress. For the CURRENT book this adds nothing: the system prompt\'s "Current book" and "Reading position" lines already carry everything (including an explicit note when the position is not recorded). Call it only for another book or when the user asks about status. bookId defaults to the current book.'
        : "Get one book's metadata and reading progress. bookId is required; resolve it with list_books first.",
    parameters:
      scope.kind === "book"
        ? obj({
            bookId: opt(str({ description: "Book id; defaults to the current book" })),
          })
        : obj({
            bookId: str({ description: "Book id from list_books" }),
          }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      const target = (normalizeBookIdParam(bookId) ?? defaultBookId) as Id | undefined;
      if (!target) throw new Error("bookId is required in the global thread");
      const book = await deps.library.getBook(target);
      if (!book) throw new Error(`unknown book: ${target}`);
      return textResult(book);
    },
  };

  const getAnnotations: AgentTool = {
    name: "get_annotations",
    label: "Annotations",
    description:
      "Read a page of the user's highlights, notes, and recorded questions: {items,nextCursor,consistency}. bookId defaults to the current book. Follow nextCursor with the SAME bookId/kind/query to continue. Newest first; live pages are not a frozen export snapshot. Byte limits can produce shorter pages; always follow nextCursor. Oversized individual annotations reject with annotations/read-budget-exceeded, never truncated text. Pass annotationId for one exact ID (zero or one items) plus its revision token, required for editing/batch changes; do not combine it with query/cursor. kind filters the annotation type. Omit query to browse without a text filter.",
    parameters: obj({
      bookId: opt(str({ description: "Book id; defaults to the current book" })),
      annotationId: opt(str({ description: "Exact annotation ID; does not scan the annotation list" })),
      kind: opt(oneOf(["highlight", "note", "ask"])),
      limit: opt(int({ minimum: 1, maximum: 100, description: "Rows per page, default 20" })),
      cursor: opt(str({ description: "Opaque nextCursor from the preceding page" })),
      query: opt(
        str({
          description:
            "Exact text filter over annotation contents. Omit to list all annotations (recommended default).",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { bookId, query, annotationId, kind, limit, cursor } = params as {
        bookId?: string;
        query?: string;
        annotationId?: string;
        kind?: "highlight" | "note" | "ask";
        limit?: number;
        cursor?: string;
      };
      const target = (normalizeBookIdParam(bookId) ?? defaultBookId) as Id | undefined;
      if (annotationId !== undefined) {
        if (query !== undefined || cursor !== undefined)
          throw new AppError("annotations/invalid-input", "annotationId cannot be combined with query or cursor");
        const snapshot = await deps.annotations.inspectAnnotation(annotationId as Id);
        const annotation = snapshot?.annotation;
        const matches = annotation && (!target || annotation.bookId === target) && (!kind || annotation.kind === kind);
        return textResult({
          items: matches ? [annotation] : [],
          revision: matches ? snapshot!.revision : null,
          nextCursor: null,
          consistency: "live",
        });
      }
      return textResult(await deps.annotations.pageAnnotations({ bookId: target, query, kind, limit, cursor }));
    },
  };

  return scope.kind === "book" ? [getBookOverview, getAnnotations] : [listBooks, getBookOverview, getAnnotations];
}
