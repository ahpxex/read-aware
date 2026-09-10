import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeBookRangeQuery, type BookTextRange } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { bookRangeSchema } from "./book-range-schema";

export function buildSelectionTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "set_reading_selection", label: "Reading selection",
    description: "Select a versioned passage in the already open book, or clear an observed selection ID. Copy range from find_book_locations, read_book_range or get_reading_session; never invent an anchor. Selecting navigates and waits for the selection UI to commit. Clear requires selectionId from an earlier receipt or session.selection.id and rejects a newer selection. Returns identity only, never passage text or extra spoiler access. Cancellation does not undo an already displayed selection. Use only for an explicit user request.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("select"), Type.Literal("clear")]),
      range: Type.Optional(bookRangeSchema),
      selectionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as { action: "select" | "clear"; range?: BookTextRange; selectionId?: string };
      if (!input || Object.keys(input).some(key => !["action", "range", "selectionId"].includes(key))
        || (input.action === "select" ? !input.range || input.selectionId !== undefined
          : input.action !== "clear" || input.range !== undefined || typeof input.selectionId !== "string"
            || !input.selectionId.trim() || input.selectionId.length > 256)) {
        throw new AppError("reader/invalid-target", "Use select with range or clear with an observed selectionId");
      }
      const range = input.action === "select" ? normalizeBookRangeQuery({ range: input.range }).range : undefined;
      const current = await deps.reader.getSession();
      signal?.throwIfAborted();
      if (!current.sessionId || !current.bookId || current.status !== "ready") throw new AppError("reader/unavailable", "No ready reader");
      if (scope.kind === "book" && current.bookId !== scope.bookId || range && range.bookId !== current.bookId) {
        throw new AppError("reader/out-of-scope", "Selection requires the scoped book to be active");
      }
      const guard = { sessionId: current.sessionId, bookId: current.bookId };
      const receipt = range ? await deps.reader.selectRange(range, signal, guard)
        : await deps.reader.clearSelection(input.selectionId!, signal, guard);
      // UI authority does not confer text authority, including quote context.
      return textResult({ status: receipt.status, sessionId: receipt.sessionId, selectionId: receipt.selection?.id ?? null });
    },
  }];
}
