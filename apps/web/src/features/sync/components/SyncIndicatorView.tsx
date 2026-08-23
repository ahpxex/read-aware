/**
 * The header sync chip, as pure presentation.
 *
 * Split from `SyncIndicator` so the visibility policy, the snooze state and the
 * manual-sync call stay in the container. What is left here is the chip itself
 * — which is worth reviewing in each of its states (running with and without an
 * honest denominator, failed, dismissible) without a relay on the other end.
 *
 * The caller decides whether the chip appears at all: this component renders
 * whatever it is given.
 */
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { Button, IconButton, Popover, ProgressRing, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import type { SyncBacklog } from "../hooks/useSyncStatus";
import { syncCycleFraction } from "../lib/sync-progress";
import { SyncProgressDetail } from "./SyncProgressDetail";

type SyncIndicatorViewProps = {
  status: SyncStatusSnapshot;
  backlog: SyncBacklog | null;
  /** Title of the book currently moving, if any (see `useBlobBookTitle`). */
  movingTitle?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Retry now. Disabled while a cycle is already running. */
  onSyncNow: () => void;
  /** Snooze the error for 24h. Only rendered while the state is `error`. */
  onDismissError: () => void;
};

export function SyncIndicatorView({
  status,
  backlog,
  movingTitle = null,
  open,
  onOpenChange,
  onSyncNow,
  onDismissError,
}: SyncIndicatorViewProps) {
  const { t } = useTranslation("settings");
  const syncing = status.state === "syncing";
  const failed = status.state === "error";

  // Determinate when the denominators are honest (push/blob phases); the
  // pull phase spins — the relay never says how much is left.
  const fraction = syncCycleFraction(status);
  const label = syncing
    ? fraction === null
      ? t("dataSync.syncStatus.syncing")
      : `${t("dataSync.syncStatus.syncing")} ${Math.round(fraction * 100)}%`
    : failed
      ? t("dataSync.syncStatus.error")
      : t("dataSync.syncStatus.idle");

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        align="left"
        triggerLabel={t("dataSync.indicator.label")}
        triggerTooltip={label}
        triggerClassName="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-stone-500/10 hover:text-fg"
        trigger={
          <>
            {failed ? (
              <WarningCircle size={15} weight="regular" aria-hidden="true" />
            ) : syncing ? (
              <ProgressRing value={fraction} size={14} label={label} />
            ) : (
              <CheckCircle size={15} weight="regular" aria-hidden="true" />
            )}
            <span>{label}</span>
          </>
        }
        panelClassName="w-72 p-4"
      >
        <div className="space-y-3">
          <SyncProgressDetail status={status} backlog={backlog} movingTitle={movingTitle} />
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={syncing} onClick={onSyncNow}>
              {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
            </Button>
          </div>
        </div>
      </Popover>
      {failed && (
        <Tooltip content={t("dataSync.indicator.errorDismiss")} side="bottom">
          <IconButton
            size="sm"
            label={t("dataSync.indicator.errorDismiss")}
            onClick={onDismissError}
            className="h-6 w-6 rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
            icon={<X size={12} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      )}
    </span>
  );
}
