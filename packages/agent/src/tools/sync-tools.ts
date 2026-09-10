import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

export function buildSyncTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_sync_status", label: "Sync status",
    description: "Read non-sensitive sync availability, progress, last success and local queued counts. includeAccount optionally fetches current relay plan/usage; null means no relay account, not zero usage. No email, account IDs, keys, blob identities or raw cursors. Cycle-start backlog and current backlog are different samples; neither proves every device is up to date.",
    parameters: Type.Object({ includeAccount: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const snapshot = await deps.sync.snapshot();
      const backlog = snapshot.supported ? await deps.sync.backlog(signal) : null;
      const account = (params as { includeAccount?: boolean }).includeAccount ? await deps.sync.account(signal) : undefined;
      signal?.throwIfAborted(); return textResult({ snapshot, backlog, ...(account !== undefined ? { account } : {}) });
    },
  }, {
    name: "manage_sync", label: "Sync controls", executionMode: "sequential",
    description: "Open the host Data & Sync settings for login, connection, disconnect, account deletion or billing, or request one sync cycle after user approval. Opening settings does not complete those actions. Sync uses the already configured account and encryption; it cannot change credentials, cursors or ACKs. already-running means no new cycle was started, not completion. Cancelling this tool cannot undo or stop a shared sync cycle.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("settings"), Type.Literal("now")]) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      signal?.throwIfAborted(); const action = (params as { action: string })?.action;
      if (action === "settings") return textResult(await deps.sync.openSettings(signal));
      if (action !== "now") throw new AppError("ui/invalid-target", "Unknown sync action");
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "sync-now", subject: "sync" } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ requested: false }), details };
      return { ...textResult(await deps.sync.requestSync(signal)), details };
    },
  }];
}
