import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, MAX_BOOK_REMOVAL_BATCH, normalizeBookRemovalIds, normalizeBookRemovalCleanupQuery, type BookRemovalCleanupQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

export function buildListBookRemovalCleanupTool(deps: RuntimeDeps): AgentTool {
  return {
    name: "list_book_removal_cleanup", label: "Pending book file cleanup",
    description: "List durable device-local file cleanup left after books were removed. Query again after a restart or lost receipt. Does not delete anything. Pass exact returned IDs to delete_books with cleanupOnly=true after user approval. Live keyset pages are not a frozen snapshot.",
    parameters: Type.Object({ after: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const query = normalizeBookRemovalCleanupQuery(params as BookRemovalCleanupQuery);
      const page = await deps.library.listBookRemovalCleanup({ limit: query.limit, ...(query.after ? { after: query.after } : {}) });
      signal?.throwIfAborted();
      return textResult(page);
    },
  };
}

export function buildDeleteBooksTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "delete_books", label: "Delete books",
    description: "Remove an explicit batch of books after ONE host approval listing every title. Use exact IDs from list_books. Record deletion is atomic; files.status=pending means local file cleanup failed. Never claim file cleanup completed in that case. Retry those exact returned IDs with cleanupOnly=true: that operation never deletes records and refuses books restored since removal.",
    parameters: Type.Object({ bookIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { minItems: 1, maxItems: MAX_BOOK_REMOVAL_BATCH }), cleanupOnly: Type.Optional(Type.Boolean()) }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      signal?.throwIfAborted();
      const ids = normalizeBookRemovalIds((params as { bookIds: unknown }).bookIds);
      const cleanupOnly = (params as { cleanupOnly?: boolean }).cleanupOnly === true;
      const books = new Map((await deps.library.listBooks()).map(book => [book.id, book]));
      const missing = ids.filter(id => !books.has(id));
      if (!cleanupOnly && missing.length) throw new AppError("library/book-not-found", `Unknown book IDs: ${missing.join(", ")}`);
      if (cleanupOnly && ids.some(id => books.has(id))) throw new AppError("library/book-reappeared", "Cleanup cannot release a current library book");
      const titles = ids.map(id => books.get(id)?.title ?? id);
      signal?.throwIfAborted();
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope),
        request: { kind: "permission", action: "delete-books", subject: titles.map((title, i) => `${i + 1}. ${title}`).join("\n") }, signal, onUpdate });
      signal?.throwIfAborted();
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ deleted: false, reason: "User declined." }), details };
      const receipt = cleanupOnly ? await deps.library.retryBookRemovalCleanup(ids) : await deps.library.removeBooks(ids);
      return { ...textResult(receipt), details };
    },
  };
}
