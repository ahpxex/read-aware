/**
 * The detailed sync narrative, shared by the header indicator's popover and
 * the Data & Sync panel. Editorial restraint applies: a line renders only
 * when it carries information — an empty outbox and an all-zero last cycle
 * say nothing worth a line of type. While a cycle runs and the denominators
 * are honest (push/blob phases), a thin bar tracks it; the pull phase stays
 * textual because its total is unknowable.
 */
import { Caption, Progress } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { SyncBacklog } from "../hooks/useSyncStatus";
import { syncCycleFraction } from "../lib/sync-progress";

type SyncProgressDetailProps = {
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
};

export function SyncProgressDetail({ status, backlog }: SyncProgressDetailProps) {
  const { t } = useTranslation("settings");
  const { progress } = status;
  const syncing = status.state === "syncing";
  const fraction = syncCycleFraction(status);

  const stateLine =
    syncing && progress
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

  const hasBacklog = backlog !== null && backlog.events + backlog.blobs > 0;
  const lastCycle = status.lastCycle;
  const hasLastCycle =
    !syncing && lastCycle !== null && lastCycle.pulled + lastCycle.pushed + lastCycle.blobs > 0;

  return (
    <span className="block space-y-1.5">
      <Caption
        as="span"
        className={`block ${status.state === "error" ? "text-red-700" : "text-fg-muted"}`}
      >
        {stateLine}
      </Caption>
      {syncing && fraction !== null && (
        <Progress size="sm" value={fraction * 100} className="max-w-56" />
      )}
      {hasBacklog && (
        <Caption as="span" className="block text-fg-muted">
          {t("dataSync.progress.pending", {
            events: backlog.events,
            blobs: backlog.blobs,
          })}
        </Caption>
      )}
      {hasLastCycle && (
        <Caption as="span" className="block text-fg-muted">
          {t("dataSync.progress.lastCycle", {
            pulled: lastCycle.pulled,
            pushed: lastCycle.pushed,
            blobs: lastCycle.blobs,
          })}
        </Caption>
      )}
    </span>
  );
}
