/**
 * 第一批检索工具（doc §6 的子集）：全部是端口之上的本地函数，不走网络。
 * search_memory / remember / search_conversation 等记忆工具属于 Phase 2，
 * 落地时加在这里的兄弟模块里。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";

export function buildThreadTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const defaultBookId = scope.kind === "book" ? scope.bookId : undefined;

  const listBooks: AgentTool = {
    name: "list_books",
    label: "List books",
    description:
      "List every book on the user's shelf with title, author, and reading progress.",
    parameters: Type.Object({}),
    execute: async () => textResult(await deps.library.listBooks()),
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
        ? Type.Object({
            bookId: Type.Optional(
              Type.String({ description: "Book id; defaults to the current book" }),
            ),
          })
        : Type.Object({
            bookId: Type.String({ description: "Book id from list_books" }),
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
      "Read a page of the user's highlights, notes, and recorded questions: {items,nextCursor,consistency}. bookId defaults to the current book. Follow nextCursor with the SAME bookId/kind/query to continue. Newest first; live pages are not a frozen export snapshot. Pass annotationId for one exact ID (zero or one items) plus its revision token, required for editing/batch changes; do not combine it with query/cursor. kind filters the annotation type. Omit query to browse without a text filter.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String({ description: "Book id; defaults to the current book" })),
      annotationId: Type.Optional(Type.String({ description: "Exact annotation ID; does not scan the annotation list" })),
      kind: Type.Optional(Type.Union([Type.Literal("highlight"), Type.Literal("note"), Type.Literal("ask")])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Rows per page, default 20" })),
      cursor: Type.Optional(Type.String({ description: "Opaque nextCursor from the preceding page" })),
      query: Type.Optional(
        Type.String({
          description:
            "Exact text filter over annotation contents. Omit to list all annotations (recommended default).",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { bookId, query, annotationId, kind, limit, cursor } = params as {
        bookId?: string; query?: string; annotationId?: string; kind?: "highlight" | "note" | "ask"; limit?: number; cursor?: string;
      };
      const target = (normalizeBookIdParam(bookId) ?? defaultBookId) as Id | undefined;
      if (annotationId !== undefined) {
        if (query !== undefined || cursor !== undefined) throw new AppError("annotations/invalid-input", "annotationId cannot be combined with query or cursor");
        const snapshot = await deps.annotations.inspectAnnotation(annotationId as Id);
        const annotation = snapshot?.annotation;
        const matches = annotation && (!target || annotation.bookId === target) && (!kind || annotation.kind === kind);
        return textResult({ items: matches ? [annotation] : [], revision: matches ? snapshot!.revision : null, nextCursor: null, consistency: "live" });
      }
      return textResult(await deps.annotations.pageAnnotations({ bookId: target, query, kind, limit, cursor }));
    },
  };

  return scope.kind === "book"
    ? [getBookOverview, getAnnotations]
    : [listBooks, getBookOverview, getAnnotations];
}
