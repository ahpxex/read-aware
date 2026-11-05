import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, type PluginScheduleControl, type PluginScheduleQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";
import { int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

export function buildScheduleTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  if (scope.kind !== "global") return [];
  return [
    {
      name: "list_plugin_schedules",
      label: "Plugin schedules",
      description:
        "List currently bound manifest schedules and their latest persisted attempt, success or failure. everyMinutes=null identifies a deferred task; deferred describes its most recent named request, not an execution archive. queued is not completed, and interrupted must not be retried blindly. Results are bounded and contain no plugin settings. Paused schedules do not run automatically; running tasks do not overlap. Nothing runs while the app is closed; this is not an OS job or complete execution history.",
      parameters: obj({
        pluginId: opt(str({ minLength: 1, maxLength: 256 })),
        offset: opt(int({ minimum: 0 })),
        limit: opt(int({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const page = await deps.schedules.list(params as PluginScheduleQuery);
        signal?.throwIfAborted();
        return textResult(page);
      },
    },
    {
      name: "manage_plugin_schedule",
      label: "Control plugin schedule",
      executionMode: "sequential",
      description:
        "Pause, resume, or run one already-bound plugin schedule after user approval. Pause/resume are persisted locally; pause does not abort an in-flight task. Run bypasses pause and cadence once without resuming automatic execution. already-running is not successful completion. Cancelling cannot undo callback side effects already dispatched; only a completed callback and saved outcome return completed. Does not install plugins, change cadence or create arbitrary scripts.",
      parameters: obj({
        pluginId: str({ minLength: 1, maxLength: 256 }),
        id: str({ minLength: 1, maxLength: 256 }),
        action: oneOf(["pause", "resume", "run"]),
      }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        signal?.throwIfAborted();
        const input = params as PluginScheduleControl;
        if (
          !input ||
          !["pause", "resume", "run"].includes(input.action) ||
          typeof input.pluginId !== "string" ||
          typeof input.id !== "string"
        )
          throw new AppError("ui/invalid-target", "Invalid schedule action");
        const page = await deps.schedules.list({ pluginId: input.pluginId, limit: 100 });
        const schedule = page.schedules.find((item) => item.id === input.id);
        if (!schedule) throw new AppError("ui/unavailable", "Schedule is not bound");
        const { answer, details } = await requestUserInteraction({
          deps,
          toolCallId,
          threadKey: threadScopeKey(scope),
          signal,
          onUpdate,
          request: {
            kind: "permission",
            action: "manage-schedule",
            subject: `${input.action}: ${input.pluginId} / ${schedule.label}`,
          },
        });
        if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ changed: false }), details };
        return { ...textResult(await deps.schedules.control(input, signal)), details };
      },
    },
  ];
}
