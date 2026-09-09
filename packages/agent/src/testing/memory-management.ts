import { AppError, normalizeMemoryMutation, type MemoryRecord, type MemorySnapshot } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

/** In-memory contract fixture; native transaction/ABA correctness is tested in Rust. */
export function createMemoryManagementFixture(rows: MemoryRecord[]): RuntimeDeps["memoryManagement"] {
  const versions = new Map<string, { fingerprint: string; revision: string }>();
  const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new AppError("memory/cancelled", "Cancelled"); };
  const inspect = async (id: string, signal?: AbortSignal): Promise<MemorySnapshot | null> => {
    cancelled(signal);
    const memory = rows.find(row => row.id === id && (!row.status || row.status === "active"));
    if (!memory) return null;
    const fingerprint = JSON.stringify(memory); let current = versions.get(id);
    if (!current || current.fingerprint !== fingerprint) {
      current = { fingerprint, revision: `mem1:${Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("")}` };
      versions.set(id, current);
    }
    return { memory: structuredClone(memory), revision: current.revision };
  };
  return { inspect, mutate: async (input, signal) => {
    const change = normalizeMemoryMutation(input); cancelled(signal);
    const before = await inspect(change.memoryId, signal);
    if (!before) throw new AppError("memory/not-found", "Missing memory");
    if (before.revision !== change.expectedRevision) throw new AppError("memory/conflict", "Memory changed");
    cancelled(signal);
    const row = rows.find(row => row.id === change.memoryId)!;
    if (change.op === "correct") row.content = change.content;
    else if (change.op === "setPinned") row.pinned = change.pinned;
    else row.status = "forgotten";
    versions.delete(row.id);
    return { memoryId: row.id, revision: (await inspect(row.id))?.revision ?? null };
  } };
}
