/**
 * 第一批检索工具（doc §6 的子集）：全部是端口之上的本地函数，不走网络。
 * search_memory / remember / search_conversation 等记忆工具属于 Phase 2，
 * 落地时加在这里的兄弟模块里。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}

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
      "Get one book's metadata and reading progress. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String({ description: "Book id; defaults to the current book" })),
    }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      const target = (bookId ?? defaultBookId) as Id | undefined;
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
      "List the user's highlights and notes. bookId defaults to the current book. Call it WITHOUT query to see everything — only pass query when hunting for one specific phrase.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String({ description: "Book id; defaults to the current book" })),
      query: Type.Optional(
        Type.String({
          description:
            "Exact text filter over annotation contents. Omit to list all annotations (recommended default).",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { bookId, query } = params as { bookId?: string; query?: string };
      const target = (bookId ?? defaultBookId) as Id | undefined;
      const annotations = await deps.annotations.listAnnotations({ bookId: target, query });
      return textResult(annotations);
    },
  };

  return scope.kind === "book"
    ? [getBookOverview, getAnnotations]
    : [listBooks, getBookOverview, getAnnotations];
}
