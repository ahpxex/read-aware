import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, type BookTextTaskSnapshot } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam, resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import { bool, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

function presentTask({ timeoutMs, ...snapshot }: BookTextTaskSnapshot) {
  return { ...snapshot, timeLimit: `${timeoutMs / 1000}s` };
}

export function buildBookTextTaskTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const tasks = deps.bookText.preparation;
  if (!tasks) return [];
  const book = (bookId: string | undefined) => resolveBookId(scope, normalizeBookIdParam(bookId));
  return [
    {
      name: "prepare_book_text",
      label: "Prepare book text",
      description:
        "Start a background derived-text preparation request for a book (defaults to current book). This returns a task receipt, not completed text: check get_book_text_tasks later instead of polling repeatedly in this turn. Default resumes successful checkpoints or reuses the final index. Set rebuild=true only when the reader explicitly requests a fresh index: it discards the prior derived index and rereads all required sections; busy shared work rejects rebuild rather than interrupting others. It may download a missing source, never performs OCR, and does not rebuild book memory. Tasks are local to this app process. priority defaults to normal; background yields to normal section requests. timeoutMs defaults to 1800000 (30 minutes), range 1000..7200000. Its wall-clock deadline includes queueing, reader yielding and pause; expiration fails only this request and preserves saved checkpoints. Both always yield during reader activity; this is not an override of reader responsiveness.",
      parameters: obj({
        bookId: opt(str()),
        rebuild: opt(bool()),
        timeoutMs: opt(int({ minimum: 1000, maximum: 7200000 })),
        priority: opt(oneOf(["normal", "background"])),
      }),
      execute: async (_id, params) => {
        const input = params as {
          bookId?: string;
          rebuild?: boolean;
          timeoutMs?: number;
          priority?: "normal" | "background";
        };
        return textResult(
          presentTask(
            await tasks.start(book(input.bookId), {
              rebuild: input.rebuild,
              priority: input.priority,
              timeoutMs: input.timeoutMs,
            }),
          ),
        );
      },
    },
    {
      name: "get_book_text_tasks",
      label: "Book text requests",
      description:
        "Read this Agent's local text preparation requests for a book, or one taskId returned by prepare_book_text. Lists newest first, 10 per page by default (maximum 20); nextOffset is null at the end. Offset pages are snapshots, not stable across new requests or eviction. Returns queued/running/paused/completed/failed/cancelled, revision, priority, timeLimit/deadlineAt, waitReason (queue/reader or null), source text-state and stable failure code. Does not start work or download. Other plugins' tasks are not exposed. Task handles expire on app restart and old terminal tasks may be evicted; get_book_text_task_history reads bounded persisted metadata across restarts; use get_book_text_status for current source availability.",
      parameters: obj({
        bookId: opt(str()),
        taskId: opt(str()),
        offset: opt(int({ minimum: 0 })),
        limit: opt(int({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_id, params) => {
        const input = params as { bookId?: string; taskId?: string; offset?: number; limit?: number };
        const bookId = book(input.bookId);
        if (input.taskId !== undefined) return textResult(presentTask(await tasks.get(bookId, input.taskId)));
        const offset = input.offset ?? 0,
          limit = input.limit ?? 10;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
          throw new AppError("library/invalid-input", "Invalid text task page");
        }
        const all = (await tasks.list(bookId)).reverse();
        return textResult({
          tasks: all.slice(offset, offset + limit).map(presentTask),
          total: all.length,
          offset,
          nextOffset: offset + limit < all.length ? offset + limit : null,
        });
      },
    },
    {
      name: "get_book_text_task_history",
      label: "Text preparation history",
      description:
        "Read this actor's local persisted text-request metadata for one book, newest first, 20 per page. At most 64 requests are retained per owner, including live requests. History is separate from current source readiness: inspect snapshot and recordedAt. requestAvailable means its exact process-local handle remains; interrupted marks a previously active request whose owner generation is gone. It does not restart work or authorize resume of an old handle. A new prepare request can use validated saved checkpoints; never silently rebuild. Reads wait for metadata writes and report persistence failures instead of an empty history. Other plugins' history is private; no chapter text is returned.",
      parameters: obj({
        bookId: opt(str()),
        offset: opt(int({ minimum: 0, maximum: 64 })),
        limit: opt(int({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_id, params) => {
        const input = params as { bookId?: string; offset?: number; limit?: number };
        const page = await tasks.history(book(input.bookId), { offset: input.offset, limit: input.limit });
        return textResult({
          ...page,
          items: page.items.map((entry) => ({ ...entry, snapshot: presentTask(entry.snapshot) })),
        });
      },
    },
    {
      name: "cancel_book_text_task",
      label: "Cancel text request",
      description:
        "Cancel one text preparation request previously created by this Agent for the same book. Cancellation releases this request only: other readers/plugins may keep the shared extraction running and already dispatched writes/downloads are not undone. Terminal tasks are unchanged. Do not claim all extraction was stopped or the index was rolled back.",
      parameters: obj({ bookId: opt(str()), taskId: str() }),
      execute: async (_id, params) => {
        const input = params as { bookId?: string; taskId: string };
        return textResult(presentTask(await tasks.cancel(book(input.bookId), input.taskId)));
      },
    },
    {
      name: "set_book_text_task_priority",
      label: "Set text request priority",
      description:
        "Change normal/background priority of this Agent-owned active or paused text request. Applies at the next section dispatch, without restarting or discarding checkpoints. Shared extraction uses the highest live consumer priority; another reader can keep it normal. Both priorities yield to reader activity. At most two section reads run at once; pending background work receives a turn after four normal dispatches. Terminal requests are unchanged.",
      parameters: obj({
        bookId: opt(str()),
        taskId: str(),
        priority: oneOf(["normal", "background"]),
      }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const input = params as { bookId?: string; taskId: string; priority: "normal" | "background" };
        return textResult(presentTask(await tasks.setPriority(book(input.bookId), input.taskId, input.priority)));
      },
    },
    ...(["pause", "resume"] as const).map((action) => ({
      name: `${action}_book_text_task`,
      label: `${action === "pause" ? "Pause" : "Resume"} text request`,
      description:
        action === "pause"
          ? "Pause this Agent-owned text request without losing its handle or saved checkpoints. Releases only this request: other readers/plugins may continue the shared extraction and dispatched I/O may drain. Paused is not a claim of globally stopped parsing."
          : "Resume this Agent-owned paused text request using the same handle and saved checkpoints. A rebuild resets only if its initial reset had not completed before pausing. Terminal/running requests are unchanged; failures stay visible and require an explicit new request.",
      parameters: obj({ bookId: opt(str()), taskId: str() }),
      executionMode: "sequential" as const,
      execute: async (_id: string, params: unknown) => {
        const input = params as { bookId?: string; taskId: string };
        return textResult(presentTask(await tasks[action](book(input.bookId), input.taskId)));
      },
    })),
  ];
}
