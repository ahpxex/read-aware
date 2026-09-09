import { AppError, type DomainEvent, type MemorySnapshot } from "@read-aware/core";
import type { MemoryChange } from "../ports";

type MaintenanceEvent = Extract<DomainEvent, { type: "memory.revised" | "memory.superseded" | "memory.forgotten" }>;
export type MemoryMaintenanceDraft = MaintenanceEvent extends infer E
  ? E extends { type: infer T; payload: infer P } ? { type: T; payload: P } : never : never;

/** Freeze the read set and simulate dependent changes before minting any events. */
export function planMemoryMaintenance(changes: MemoryChange[], snapshots: MemorySnapshot[]) {
  const rows = new Map(snapshots.map(snapshot => [snapshot.memory.id, structuredClone(snapshot.memory)]));
  if (rows.size !== snapshots.length) throw new AppError("memory/invalid-input", "Duplicate memory snapshot");
  const conditions = snapshots.map(snapshot => ({ memoryId: snapshot.memory.id, revision: snapshot.revision }));
  const events: MemoryMaintenanceDraft[] = [];
  for (const change of changes) {
    const row = rows.get(change.id);
    if (!row || (row.status ?? "active") !== "active") throw new AppError("memory/conflict", "Maintenance target is no longer active");
    switch (change.type) {
      case "supersede": {
        const winner = change.byId && rows.get(change.byId);
        if (row.pinned || !winner || winner.id === row.id || (winner.status ?? "active") !== "active") throw new AppError("memory/invalid-input", "Invalid memory merge");
        row.status = "superseded";
        events.push({ type: "memory.superseded", payload: { memoryId: row.id, bySupersedingId: winner.id } });
        winner.evidenceCount += 1;
        winner.importance = Math.min(1, winner.importance + 0.1);
        events.push({ type: "memory.revised", payload: { memoryId: winner.id, evidenceCount: winner.evidenceCount, importance: winner.importance } });
        break;
      }
      case "forget":
        if (row.pinned) throw new AppError("memory/invalid-input", "Cannot automatically forget pinned memory");
        row.status = "forgotten";
        events.push({ type: "memory.forgotten", payload: { memoryId: row.id, reason: "decay" } });
        break;
      case "promote":
        if (!row.scope.startsWith("book:") || !["user", "global"].includes(change.scope) || row.evidenceCount < 3) throw new AppError("memory/invalid-input", "Invalid memory promotion");
        row.scope = change.scope;
        events.push({ type: "memory.revised", payload: { memoryId: row.id, scope: change.scope as "user" | "global" } });
        break;
      case "decay":
        if (row.pinned || !Number.isFinite(change.importance) || change.importance < 0 || change.importance >= row.importance) throw new AppError("memory/invalid-input", "Invalid memory decay");
        row.importance = change.importance;
        events.push({ type: "memory.revised", payload: { memoryId: row.id, importance: row.importance } });
        break;
    }
  }
  return { conditions, events, rows: [...rows.values()] };
}
