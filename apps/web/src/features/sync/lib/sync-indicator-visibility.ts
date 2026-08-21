import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";

/** Header policy only; Data & Sync settings keep the full diagnostic state. */
export function shouldShowSyncIndicator(
  status: Pick<SyncStatusSnapshot, "accountConnected" | "lastSyncAt" | "state">,
  open: boolean,
): boolean {
  if (!status.accountConnected) return false;
  if (status.state === "syncing") return true;
  if (status.state === "error") return status.lastSyncAt !== null;
  return status.state === "idle" && open;
}
