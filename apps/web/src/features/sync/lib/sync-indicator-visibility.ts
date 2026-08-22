import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";

/**
 * Header policy only; Data & Sync settings keep the full diagnostic state.
 *
 * The header speaks ONLY on failure: a running cycle is normal background
 * behavior — users don't need (and don't want) a permanent "Syncing…" chip
 * for it; live progress lives in Settings → Data & Sync. An error shows
 * until dismissed; `errorSnoozed` is the chip's dismissal state (see
 * platform/sync/sync-error-notice.ts): a snoozed error stays hidden until
 * its 24h window lapses — repeated cycle failures do not reopen it.
 */
export function shouldShowSyncIndicator(
  status: Pick<SyncStatusSnapshot, "accountConnected" | "lastSyncAt" | "state">,
  open: boolean,
  errorSnoozed: boolean = false,
): boolean {
  if (!status.accountConnected) return false;
  if (status.state === "error") return status.lastSyncAt !== null && !errorSnoozed;
  // `open` keeps an already-mounted chip (opened from its error state)
  // alive through the follow-up cycle and its idle aftermath — the popover
  // the user is reading must not vanish because a retry succeeded.
  return open;
}
