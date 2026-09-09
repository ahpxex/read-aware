import type { MemorySnapshot } from "@read-aware/core";
import { decayChanges } from "./consolidation";

function snapshotKey(snapshots: MemorySnapshot[]): string {
  return JSON.stringify(snapshots.map(snapshot => [snapshot.memory.id, snapshot.revision]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

/** Cache model work, not the store read: every actor and time-only decay count. */
export class ConsolidationCheckpoint {
  private settledKey: string | undefined;

  needed(snapshots: MemorySnapshot[], now: number): boolean {
    return this.settledKey !== snapshotKey(snapshots) || decayChanges(snapshots.map(snapshot => snapshot.memory), now).length > 0;
  }

  settle(snapshots: MemorySnapshot[], judgmentSucceeded: boolean): void {
    this.settledKey = judgmentSucceeded ? snapshotKey(snapshots) : undefined;
  }
}
