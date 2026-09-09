import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam, resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

export function buildBookTextTaskTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const tasks = deps.bookText.preparation;
  if (!tasks) return [];
  const book = (bookId: string | undefined) => resolveBookId(scope, normalizeBookIdParam(bookId));
  return [{
    name: "prepare_book_text", label: "Prepare book text",
    description: "Start a background derived-text preparation request for a book (defaults to current book). This returns a task receipt, not completed text: check get_book_text_tasks later instead of polling repeatedly in this turn. Default resumes successful checkpoints or reuses the final index. Set rebuild=true only when the reader explicitly requests a fresh index: it discards the prior derived index and rereads all required sections; busy shared work rejects rebuild rather than interrupting others. It may download a missing source, never performs OCR, and does not rebuild book memory. Tasks are local to this app process.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), rebuild: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params) => {
      const input = params as { bookId?: string; rebuild?: boolean };
      return textResult(await tasks.start(book(input.bookId), { rebuild: input.rebuild }));
    },
  }, {
    name: "get_book_text_tasks", label: "Book text requests",
    description: "Read this Agent's local text preparation requests for a book, or one taskId returned by prepare_book_text. Lists newest first, 10 per page by default (maximum 20); nextOffset is null at the end. Offset pages are snapshots, not stable across new requests or eviction. Returns queued/running/completed/failed/cancelled, revision, source text-state and stable failure code. Does not start work or download. Other plugins' tasks are not exposed. Task handles expire on app restart and old terminal tasks may be evicted; use get_book_text_status for current source availability.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()),
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
    execute: async (_id, params) => {
      const input = params as { bookId?: string; taskId?: string; offset?: number; limit?: number };
      const bookId = book(input.bookId);
      if (input.taskId !== undefined) return textResult(await tasks.get(bookId, input.taskId));
      const offset = input.offset ?? 0, limit = input.limit ?? 10;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
        throw new AppError("library/invalid-input", "Invalid text task page");
      }
      const all = (await tasks.list(bookId)).reverse();
      return textResult({ tasks: all.slice(offset, offset + limit), total: all.length, offset,
        nextOffset: offset + limit < all.length ? offset + limit : null });
    },
  }, {
    name: "cancel_book_text_task", label: "Cancel text request",
    description: "Cancel one text preparation request previously created by this Agent for the same book. Cancellation releases this request only: other readers/plugins may keep the shared extraction running and already dispatched writes/downloads are not undone. Terminal tasks are unchanged. Do not claim all extraction was stopped or the index was rolled back.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), taskId: Type.String() }),
    execute: async (_id, params) => {
      const input = params as { bookId?: string; taskId: string };
      return textResult(await tasks.cancel(book(input.bookId), input.taskId));
    },
  }];
}
