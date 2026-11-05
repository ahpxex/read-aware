import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, normalizeDurableJobPlan, type DurableJobControl } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";
import { int, obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";

export function buildDurableJobTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const port = deps.jobs?.(scope);
  if (!port) return [];
  const identity = obj({ id: str({ minLength: 1, maxLength: 128 }) });
  const subject = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    if (text.length > 16384) throw new AppError("jobs/invalid-plan", "Plan is too large to approve; use fewer steps");
    return text;
  };
  return [
    {
      name: "start_durable_job",
      label: "Start saved task",
      executionMode: "sequential",
      description:
        "Ask approval for a saved, ordered plan of up to 32 host steps. Each step has a unique id and kind: library.text.prepare with bookId/options; book.graph with bookId, mode catch-up or rebuild, options.maxChapters; transaction with semantic operations as in preview_atomic_transaction. Steps prepare against state at execution time. No arbitrary code, network callbacks, or plugin-private documents. Book conversations may only target their book. The returned queued task is not completion; inspect progress. Unknown graph/rebuild outcomes require review, never blind replay.",
      parameters: obj({ plan: unknown() }),
      execute: async (toolCallId, raw, signal, onUpdate) => {
        const plan = normalizeDurableJobPlan((raw as { plan: unknown }).plan);
        const answer = await requestUserInteraction({
          deps,
          toolCallId,
          threadKey: threadScopeKey(scope),
          signal,
          onUpdate,
          request: { kind: "permission", action: "manage-job", subject: subject({ action: "start", plan }) },
        });
        if (answer.answer.cancelled || answer.answer.optionId !== "approve")
          return textResult({ started: false, reason: "declined" });
        return textResult(await port.start(plan, signal));
      },
    },
    {
      name: "get_durable_job",
      label: "Saved task progress",
      description:
        "Read this conversation scope's saved task progress. Completed means all steps reported completion; cancelled does not undo effects of completed steps.",
      parameters: identity,
      execute: async (_id, raw, signal) => textResult(await port.get((raw as { id: string }).id, signal)),
    },
    {
      name: "list_durable_jobs",
      label: "List saved tasks",
      description:
        "List saved tasks owned by this conversation scope. Use nextOffset to continue; empty pages need not be the end.",
      parameters: obj({
        offset: opt(int({ minimum: 0, maximum: 256 })),
        limit: opt(int({ minimum: 1, maximum: 50 })),
      }),
      execute: async (_id, raw, signal) =>
        textResult(await port.list(raw as { offset?: number; limit?: number }, signal)),
    },
    {
      name: "control_durable_job",
      label: "Control saved task",
      executionMode: "sequential",
      description:
        "Pause or cancel a saved task, waiting for in-flight cleanup. Resume requires fresh user approval of its stored plan. Unknown outcomes may remain needs-attention; cancellation is not rollback. Never create a replacement to bypass an unresolved write.",
      parameters: obj({
        id: str({ minLength: 1, maxLength: 128 }),
        action: oneOf(["pause", "resume", "cancel"]),
      }),
      execute: async (toolCallId, raw, signal, onUpdate) => {
        const { id, action } = raw as { id: string; action: DurableJobControl };
        if (action === "resume") {
          const plan = await port.inspectPlan(id);
          const answer = await requestUserInteraction({
            deps,
            toolCallId,
            threadKey: threadScopeKey(scope),
            signal,
            onUpdate,
            request: { kind: "permission", action: "manage-job", subject: subject({ action, id, plan }) },
          });
          if (answer.answer.cancelled || answer.answer.optionId !== "approve")
            return textResult({ resumed: false, reason: "declined" });
        }
        return textResult(await port.control(id, action, signal));
      },
    },
  ];
}
