import { AppError, normalizeMemoryMutation, validateMemoryId, type EventOrigin, type MemoryMutation, type MemoryMutationReceipt, type MemorySnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

const assertDesktop = () => { if (!isTauri()) throw new AppError("memory/unavailable", "Memory management requires desktop storage"); };
const assertLive = (signal?: AbortSignal) => { if (signal?.aborted) throw new AppError("memory/cancelled", "Memory management owner cancelled"); };
export async function inspectMemory(id: string, signal?: AbortSignal): Promise<MemorySnapshot | null> {
  validateMemoryId(id); assertDesktop(); assertLive(signal);
  const snapshot = await invoke<MemorySnapshot | null>("memory_inspect", { id });
  assertLive(signal); return snapshot;
}
export function memoryMutationDraft(input: MemoryMutation, origin: EventOrigin): DomainEventDraft {
  if (input.op === "correct") return { type: "memory.revised", payload: { memoryId: input.memoryId, content: input.content }, origin };
  if (input.op === "setPinned") return { type: "memory.feedback", payload: { memoryId: input.memoryId, signal: input.pinned ? "pin" : "unpin" }, origin };
  return { type: "memory.forgotten", payload: { memoryId: input.memoryId, reason: "user" }, origin };
}
export async function mutateMemory(input: MemoryMutation, origin: EventOrigin, signal?: AbortSignal): Promise<MemoryMutationReceipt> {
  const change = normalizeMemoryMutation(input);
  assertDesktop(); assertLive(signal);
  const draft = memoryMutationDraft(change, origin);
  const [event] = await mintEventRows([draft]);
  assertLive(signal);
  // After dispatch, return the committed receipt even if the caller cancels; cancellation is not undo.
  const result = await invoke<MemoryMutationReceipt>("memory_commit", { event, expectedRevision: change.expectedRevision });
  broadcastDomainEventDrafts([draft]);
  return result;
}
