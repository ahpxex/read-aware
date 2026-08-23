/**
 * Header sync indicator — the header's ONLY sync surface, and it speaks
 * only on failure (see lib/sync-indicator-visibility): a running cycle is
 * normal background behavior and its live progress lives in Settings →
 * Data & Sync instead. When a failure does surface, clicking opens the
 * detailed popover (with a retry), and the X beside the chip snoozes the
 * error for 24h — repeated failures inside that window stay quiet, and the
 * settings panel keeps showing the diagnostic regardless.
 *
 * This half decides whether the chip appears and what a click does; the chip
 * itself is `SyncIndicatorView`.
 */
import { useState } from "react";
import { createLogger } from "../../../platform/logger";
import {
  dismissSyncErrorNotice,
  isSyncErrorSnoozedAt,
  readSyncErrorDismissedAt,
} from "../../../platform/sync/sync-error-notice";
import { syncNow } from "../../../platform/sync/sync-scheduler";
import { useBlobBookTitle } from "../hooks/useBlobBookTitle";
import { useSyncBacklog, useSyncStatus } from "../hooks/useSyncStatus";
import { shouldShowSyncIndicator } from "../lib/sync-indicator-visibility";
import { SyncIndicatorView } from "./SyncIndicatorView";

const log = createLogger("sync");

export function SyncIndicator() {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(() =>
    readSyncErrorDismissedAt(),
  );
  const backlog = useSyncBacklog(open);
  const movingTitle = useBlobBookTitle(
    status.state === "syncing" ? (status.progress?.blobKey ?? null) : null,
  );

  const errorSnoozed = status.state === "error" && isSyncErrorSnoozedAt(dismissedAt);
  // `open` keeps the chip mounted through the end of a cycle — a popover the
  // user is reading must not vanish because the sync finished under it. It
  // never overrides the account/first-success error policy, though.
  if (!shouldShowSyncIndicator(status, open, errorSnoozed)) return null;

  return (
    <SyncIndicatorView
      status={status}
      backlog={backlog}
      movingTitle={movingTitle}
      open={open}
      onOpenChange={setOpen}
      onSyncNow={() => {
        void syncNow().catch((error) => {
          // The status snapshot already flipped to "error"; the popover
          // renders it — no toast needed from up here.
          log.error("manual sync failed", error);
        });
      }}
      onDismissError={() => {
        setDismissedAt(dismissSyncErrorNotice());
        setOpen(false);
      }}
    />
  );
}
