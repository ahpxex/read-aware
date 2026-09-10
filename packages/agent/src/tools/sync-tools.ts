import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type HostSyncFlowRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

export function buildSyncTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_sync_status", label: "Sync status",
    description: "Read non-sensitive sync availability, progress, last success and local queued counts. includeAccount optionally fetches current relay plan/usage; null means no relay account, not zero usage. includeConnections lists registered backend refs and display labels for manage_sync(connect); omit transportRef there for relay sign-in. No email, account IDs, keys, blob identities or raw cursors. Cycle-start backlog and current backlog are different samples; neither proves every device is up to date.",
    parameters: Type.Object({ includeAccount: Type.Optional(Type.Boolean()), includeConnections: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const snapshot = await deps.sync.snapshot();
      const backlog = snapshot.supported ? await deps.sync.backlog(signal) : null;
      const account = (params as { includeAccount?: boolean }).includeAccount ? await deps.sync.account(signal) : undefined;
      const connections = (params as { includeConnections?: boolean }).includeConnections ? await deps.sync.connectionOptions() : undefined;
      signal?.throwIfAborted(); return textResult({ snapshot, backlog, ...(account !== undefined ? { account } : {}), ...(connections ? { connections } : {}) });
    },
  }, {
    name: "manage_sync", label: "Sync controls", executionMode: "sequential",
    description: "On explicit user intent, request a host-owned connect, disconnect, delete-account, upgrade or billing flow and wait for its outcome. Identity, secrets and destructive confirmation stay in the native UI; never supply credentials or approve for the user. transportRef selects a registered backend from get_sync_status(includeConnections); omit it for relay sign-in. external-opened only confirms browser handoff, not a purchase or billing change. settings only opens the page; now starts a sync cycle after user approval (already-running is not completion). Cancellation ends waiting/unconfirmed flows, never rolls back an already confirmed operation or a shared sync cycle.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("settings"), Type.Literal("now"), Type.Literal("connect"), Type.Literal("disconnect"), Type.Literal("delete-account"), Type.Literal("upgrade"), Type.Literal("billing")]), transportRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      signal?.throwIfAborted(); const { action, transportRef } = params as HostSyncFlowRequest | { action: "settings" | "now"; transportRef?: string };
      if (transportRef !== undefined && action !== "connect") throw new AppError("ui/invalid-target", "Backend selection is only valid for connect");
      if (action === "settings") return textResult(await deps.sync.openSettings(signal));
      if (["connect", "disconnect", "delete-account", "upgrade", "billing"].includes(action)) {
        const receipt = await deps.sync.requestFlow({ action: action as HostSyncFlowRequest["action"], ...(transportRef !== undefined ? { transportRef } : {}) }, signal);
        signal?.throwIfAborted(); return textResult(receipt);
      }
      if (action !== "now") throw new AppError("ui/invalid-target", "Unknown sync action");
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "sync-now", subject: "sync" } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ requested: false }), details };
      return { ...textResult(await deps.sync.requestSync(signal)), details };
    },
  }];
}
