import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, validateClassificationBookId } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

export function buildBookGraphTaskTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return { name: "manage_book_graph", label: "Book graph tasks", executionMode: "sequential",
    description: "List/get graph generation tasks, start missing-chapter catch-up, rebuild existing digests, cancel, or retry an unfinished terminal task. Start/rebuild/retry each require user approval and may incur model charges. Read task status after acceptance; do not repeatedly poll. Cancellation may remain cancelling until dispatched writes settle and never undoes committed digests or provider charges. Failed rebuilds preserve old digests; retry retains unfinished targets. Handles are Agent-owned for this app session, not plugin tasks or automatic upkeep. Generation obeys the live host reading boundary (including global threads), never caller-supplied spoiler overrides. Book threads may manage only their book. Automatic memory/privacy settings still apply.",
    parameters: Type.Object({ action: Type.Union(["list", "get", "start", "rebuild", "cancel", "retry"].map(value => Type.Literal(value))),
      bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new AppError("memory/invalid-input", "Expected a graph task request");
      const raw = { ...params } as { action: string; bookId?: string; taskId?: string; offset?: number; limit?: number };
      const keys = ["action", "bookId", ...(["get", "cancel", "retry"].includes(raw.action) ? ["taskId"] : raw.action === "list" ? ["offset", "limit"] : [])];
      if (!["list", "get", "start", "rebuild", "cancel", "retry"].includes(raw.action) || Object.keys(raw).some(key => !keys.includes(key))) throw new AppError("memory/invalid-input", "Invalid graph task action");
      const bookId = raw.bookId ?? (scope.kind === "book" ? scope.bookId : ""); validateClassificationBookId(bookId);
      if (scope.kind === "book" && scope.bookId !== bookId) throw new AppError("memory/forbidden", "Graph task belongs to another book");
      if (["get", "cancel", "retry"].includes(raw.action) && (typeof raw.taskId !== "string" || !raw.taskId.trim() || raw.taskId.length > 256)) throw new AppError("memory/invalid-input", "A task ID is required");
      signal?.throwIfAborted();
      const tasks = deps.bookGraphTasks;
      if (raw.action === "list") {
        const offset = raw.offset ?? 0, limit = raw.limit ?? 10;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new AppError("memory/invalid-input", "Invalid task page");
        const all = await tasks.list(bookId);
        return textResult({ tasks: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null });
      }
      if (raw.action === "get") return textResult(await tasks.get(bookId, raw.taskId!));
      if (raw.action === "cancel") return textResult(await tasks.cancel(bookId, raw.taskId!));
      if (raw.action === "retry") {
        const old = await tasks.get(bookId, raw.taskId!);
        if (!["failed", "cancelled", "partial", "unavailable"].includes(old.status)) throw new AppError("memory/conflict", "Task is not retryable");
      }
      const book = await deps.library.getBook(bookId);
      if (!book) throw new AppError("reader/book-not-found", "Book not found");
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "generate-book-graph", subject: `${book.title}\n${bookId}\n${raw.action}${raw.taskId ? `\n${raw.taskId}` : ""}` } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ started: false }), details };
      signal?.throwIfAborted();
      return { ...textResult(raw.action === "retry" ? await tasks.retry(bookId, raw.taskId!, signal)
        : await tasks.start(bookId, raw.action === "rebuild" ? "rebuild" : "catch-up", signal)), details };
    },
  };
}
