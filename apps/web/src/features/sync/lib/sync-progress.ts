/**
 * Pure derivations over the sync status snapshot, shared by the header
 * indicator and the settings detail so both surfaces agree on what "63%"
 * means.
 */
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";

/**
 * Completion fraction of the running cycle, or null when it cannot be known
 * honestly: no cycle running, or the pull phase (the relay never announces
 * how much remains, so a pull renders indeterminate rather than invented).
 */
export function syncCycleFraction(status: SyncStatusSnapshot): number | null {
  const { progress, cycleTotals } = status;
  if (!progress || status.state !== "syncing") return null;
  if (progress.phase === "push") {
    if (!cycleTotals || cycleTotals.events <= 0) return null;
    return Math.min(1, progress.pushed / cycleTotals.events);
  }
  if (progress.phase === "blobs") {
    if (progress.blobsTotal <= 0) return null;
    return Math.min(1, progress.blobsDone / progress.blobsTotal);
  }
  return null;
}
