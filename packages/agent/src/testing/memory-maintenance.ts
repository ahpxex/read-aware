import { AppError, normalizeMemoryQuery, type MemoryRecord, type MemorySnapshot } from "@read-aware/core";
import type { MemoryPort, RuntimeDeps } from "../ports";
import { planMemoryMaintenance } from "../memory/maintenance-plan";
import { matchesMemoryQuery } from "../memory/query-match";

export function createMemoryMaintenanceFixture(rows: MemoryRecord[], management: RuntimeDeps["memoryManagement"]): Pick<MemoryPort, "snapshotMemories" | "reinforceMemory" | "applyMemoryChanges"> {
  const assertCurrent = async (snapshots: MemorySnapshot[], signal?: AbortSignal) => {
    for (const snapshot of snapshots) {
      const current = await management.inspect(snapshot.memory.id, signal);
      if (!current || current.revision !== snapshot.revision) throw new AppError("memory/conflict", "Maintenance snapshot changed");
    }
    if (signal?.aborted) throw new AppError("memory/cancelled", "Maintenance cancelled");
    for (const snapshot of snapshots) {
      if (JSON.stringify(rows.find(row => row.id === snapshot.memory.id)) !== JSON.stringify(snapshot.memory)) throw new AppError("memory/conflict", "Maintenance snapshot changed");
    }
  };
  return {
    snapshotMemories: async filter => {
      let snapshots = (await Promise.all(rows.map(row => management.inspect(row.id)))).filter((row): row is MemorySnapshot => !!row);
      if (filter) {
        const query = normalizeMemoryQuery(filter);
        snapshots = snapshots.filter(({ memory }) => query.scopes.includes(memory.scope) && (!query.query || matchesMemoryQuery(memory.content, query.query)))
          .sort((a, b) => Number(b.memory.pinned ?? false) - Number(a.memory.pinned ?? false) || b.memory.importance - a.memory.importance || b.memory.updatedAt.localeCompare(a.memory.updatedAt)).slice(0, query.limit);
      }
      return snapshots;
    },
    reinforceMemory: async (input, signal) => {
      const snapshot = structuredClone(input);
      await assertCurrent([snapshot], signal);
      const row = rows.find(row => row.id === snapshot.memory.id)!;
      row.evidenceCount += 1; row.importance = Math.min(1, row.importance + 0.15); row.updatedAt = new Date().toISOString();
    },
    applyMemoryChanges: async (changes, input, signal) => {
      const snapshots = structuredClone(input), plan = planMemoryMaintenance(changes, snapshots);
      await assertCurrent(snapshots, signal);
      const touched = new Set(plan.events.map(event => event.payload.memoryId));
      for (const next of plan.rows) if (touched.has(next.id)) Object.assign(rows.find(row => row.id === next.id)!, next, { updatedAt: new Date().toISOString() });
      return (await Promise.all(snapshots.map(snapshot => management.inspect(snapshot.memory.id)))).filter((snapshot): snapshot is MemorySnapshot => !!snapshot);
    },
  };
}
