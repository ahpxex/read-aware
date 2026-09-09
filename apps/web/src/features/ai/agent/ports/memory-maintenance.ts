import { planMemoryMaintenance, type MemoryChange } from "@read-aware/agent";
import { AppError, type MemorySnapshot } from "@read-aware/core";
import { invoke } from "../../../../platform/ipc";
import { isTauri } from "../../../../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../../../../platform/domain-events";

function assertAllowed(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("memory/unavailable", "Memory maintenance requires desktop storage");
  if (signal?.aborted) throw new AppError("memory/cancelled", "Memory maintenance cancelled");
}
export async function snapshotMemories(): Promise<MemorySnapshot[]> {
  assertAllowed();
  return invoke("memories_snapshot");
}
async function commitMaintenance(conditions: { memoryId: string; revision: string }[], drafts: DomainEventDraft[], signal?: AbortSignal) {
  assertAllowed(signal);
  if (!drafts.length) return [];
  const events = await mintEventRows(drafts);
  assertAllowed(signal);
  const committed = await invoke<MemorySnapshot[]>("memory_maintenance_commit", { conditions, events });
  broadcastDomainEventDrafts(drafts);
  return committed;
}
export async function applyMemoryChanges(changes: MemoryChange[], snapshots: MemorySnapshot[], signal?: AbortSignal) {
  assertAllowed(signal);
  const plan = planMemoryMaintenance(changes, snapshots);
  if (!plan.events.length) return structuredClone(snapshots);
  return commitMaintenance(plan.conditions, plan.events.map(event => ({ ...event, origin: "agent" })), signal);
}
export async function reinforceMemory(snapshot: MemorySnapshot, signal?: AbortSignal) {
  const { memory, revision } = structuredClone(snapshot);
  await commitMaintenance([{ memoryId: memory.id, revision }], [{ type: "memory.revised", origin: "agent", payload: {
    memoryId: memory.id, importance: Math.min(1, memory.importance + 0.15), evidenceCount: memory.evidenceCount + 1,
  } }], signal);
}
