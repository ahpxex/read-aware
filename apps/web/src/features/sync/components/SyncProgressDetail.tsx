/**
 * The sync facts as a quiet metadata strip — icon + caption pairs that wrap,
 * shared by the header popover and the Data & Sync panel. Editorial
 * restraint: an item renders only when it says something (an empty outbox
 * and an all-zero cycle say nothing). While a cycle runs with honest
 * denominators (push/blob phases), a thin bar tracks it; the pull phase
 * stays textual because its total is unknowable.
 */
import {
  ArrowsClockwise,
  ClockCounterClockwise,
  CloudCheck,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { Caption, Progress, ProgressRing } from "@read-aware/ui";
import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { SyncBacklog } from "../hooks/useSyncStatus";
import { syncCycleFraction } from "../lib/sync-progress";

type SyncProgressDetailProps = {
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
  /** Formatted relay storage usage (settings panel only). */
  storage?: string | null;
};

function Item({ icon, tone, children }: { icon: ReactNode; tone?: "error"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${tone === "error" ? "text-red-700" : "text-fg-muted"}`}
    >
      {icon}
      <Caption as="span">{children}</Caption>
    </span>
  );
}

const ICON = { size: 14, weight: "regular", "aria-hidden": true } as const;

export function SyncProgressDetail({ status, backlog, storage }: SyncProgressDetailProps) {
  const { t } = useTranslation("settings");
  const { progress } = status;
  const syncing = status.state === "syncing";
  const fraction = syncCycleFraction(status);

  const hasBacklog = backlog !== null && backlog.events + backlog.blobs > 0;
  const lastCycle = status.lastCycle;
  const hasLastCycle =
    !syncing && lastCycle !== null && lastCycle.pulled + lastCycle.pushed + lastCycle.blobs > 0;

  return (
    <span className="mt-1.5 block space-y-2">
      <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {syncing && progress ? (
          <Item icon={<ProgressRing value={fraction} size={14} />}>
            {progress.phase === "pull"
              ? t("dataSync.progress.pulling", { count: progress.pulled })
              : progress.phase === "push"
                ? t("dataSync.progress.pushing", { count: progress.pushed })
                : t("dataSync.progress.blobs", {
                    done: progress.blobsDone,
                    total: progress.blobsTotal,
                  })}
          </Item>
        ) : status.state === "error" ? (
          <Item tone="error" icon={<WarningCircle {...ICON} />}>
            {status.lastError ?? t("dataSync.syncStatus.error")}
          </Item>
        ) : (
          <Item icon={<ClockCounterClockwise {...ICON} />}>
            {status.lastSyncAt
              ? t("dataSync.syncStatus.lastSync", {
                  time: new Date(status.lastSyncAt).toLocaleTimeString(),
                })
              : t("dataSync.syncStatus.never")}
          </Item>
        )}
        {storage && <Item icon={<CloudCheck {...ICON} />}>{storage}</Item>}
        {hasBacklog && (
          <Item icon={<UploadSimple {...ICON} />}>
            {t("dataSync.progress.pending", { events: backlog.events, blobs: backlog.blobs })}
          </Item>
        )}
        {hasLastCycle && (
          <Item icon={<ArrowsClockwise {...ICON} />}>
            {t("dataSync.progress.lastCycle", {
              pulled: lastCycle.pulled,
              pushed: lastCycle.pushed,
              blobs: lastCycle.blobs,
            })}
          </Item>
        )}
      </span>
      {syncing && fraction !== null && (
        <Progress size="sm" value={fraction * 100} className="max-w-56" />
      )}
    </span>
  );
}
