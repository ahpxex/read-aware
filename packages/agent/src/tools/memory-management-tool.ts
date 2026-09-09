import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeMemoryMutation, validateMemoryId, type MemoryMutation } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

export function buildMemoryManagementTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "manage_memory", label: "Manage memory", executionMode: "sequential",
    description: "Inspect, correct, pin/unpin, or forget an existing memory identified by search_memory. Inspect first and supply that revision for changes; conflicts require a fresh read and renewed user decision, never blind retry. Every mutation asks the user to approve the exact change. Forget excludes this record from active retrieval but does not erase event history or other copies. No scope, ranking weight or evidence-count edits. Book threads may manage user/global memories and their own book, not other books. Memory building disabled does not prevent managing existing memories.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("inspect"), Type.Literal("correct"), Type.Literal("setPinned"), Type.Literal("forget")]),
      memoryId: Type.String({ minLength: 1, maxLength: 256 }), expectedRevision: Type.Optional(Type.String()),
      content: Type.Optional(Type.String({ minLength: 1, maxLength: 16000 })), pinned: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const raw = params as { action: string; memoryId: string; expectedRevision?: string; content?: string; pinned?: boolean };
      validateMemoryId(raw.memoryId);
      if (!["inspect", "correct", "setPinned", "forget"].includes(raw.action)) throw new AppError("memory/invalid-input", "Invalid memory action");
      const { action, ...fields } = raw;
      const change = action === "inspect" ? null : normalizeMemoryMutation({ ...fields, op: action } as MemoryMutation);
      if (!change && Object.keys(fields).some(key => key !== "memoryId")) throw new AppError("memory/invalid-input", "Inspect accepts only a memory ID");
      const snapshot = await deps.memoryManagement.inspect(raw.memoryId, signal);
      if (!snapshot) throw new AppError("memory/not-found", "Memory is no longer active");
      if (scope.kind === "book" && !["user", "global", `book:${scope.bookId}`].includes(snapshot.memory.scope)) throw new AppError("memory/forbidden", "Memory belongs to another book");
      if (!change) return textResult(snapshot);
      if (change.expectedRevision !== snapshot.revision) throw new AppError("memory/conflict", "Read the current memory before requesting feedback");
      const next = change.op === "correct" ? change.content : change.op === "setPinned" ? `pinned=${change.pinned}` : "forgotten";
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "manage-memory", subject: `${snapshot.memory.id} (${snapshot.memory.scope})\n${snapshot.memory.content}\n\n${change.op}:\n${next}` } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ changed: false }), details };
      return { ...textResult(await deps.memoryManagement.mutate(change, signal)), details };
    },
  };
}
