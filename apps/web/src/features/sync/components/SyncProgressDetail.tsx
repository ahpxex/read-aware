/**
 * The detailed sync narrative, shared by the header indicator's popover and
 * the Data & Sync panel: what the running cycle is doing right now, what
 * still waits in the outbox, and what the last completed cycle moved.
 * Quiet stacked text lines — it inherits whichever surface it sits in.
 */
import { Caption } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { SyncBacklog } from "../hooks/useSyncStatus";

type SyncProgressDetailProps = {
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
};

export function SyncProgressDetail({ status, backlog }: SyncProgressDetailProps) {
  const { t } = useTranslation("settings");
  const { progress } = status;

  const stateLine =
    status.state === "syncing" && progress
      ? progress.phase === "pull"
        ? t("dataSync.progress.pulling", { count: progress.pulled })
        : progress.phase === "push"
          ? t("dataSync.progress.pushing", { count: progress.pushed })
          : t("dataSync.progress.blobs", {
              done: progress.blobsDone,
              total: progress.blobsTotal,
            })
      : status.state === "error"
        ? (status.lastError ?? t("dataSync.syncStatus.error"))
        : status.lastSyncAt
          ? t("dataSync.syncStatus.lastSync", {
              time: new Date(status.lastSyncAt).toLocaleTimeString(),
            })
          : t("dataSync.syncStatus.never");

  return (
    <span className="block space-y-1">
      <Caption
        as="span"
        className={`block ${status.state === "error" ? "text-red-700" : "text-fg-muted"}`}
      >
        {stateLine}
      </Caption>
      {backlog && (
        <Caption as="span" className="block text-fg-muted">
          {backlog.events === 0 && backlog.blobs === 0
            ? t("dataSync.progress.pendingNone")
            : t("dataSync.progress.pending", {
                events: backlog.events,
                blobs: backlog.blobs,
              })}
        </Caption>
      )}
      {status.lastCycle && status.state !== "syncing" && (
        <Caption as="span" className="block text-fg-muted">
          {t("dataSync.progress.lastCycle", {
            pulled: status.lastCycle.pulled,
            pushed: status.lastCycle.pushed,
            blobs: status.lastCycle.blobs,
          })}
        </Caption>
      )}
    </span>
  );
}
