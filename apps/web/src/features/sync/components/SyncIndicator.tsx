/**
 * Header sync indicator — the header's ONLY sync surface, and it speaks
 * only on failure (see lib/sync-indicator-visibility): a running cycle is
 * normal background behavior and its live progress lives in Settings →
 * Data & Sync instead. When a failure does surface, clicking opens the
 * detailed popover (with a retry), and the X beside the chip snoozes the
 * error for 24h — repeated failures inside that window stay quiet, and the
 * settings panel keeps showing the diagnostic regardless.
 */
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { Button, IconButton, Popover, ProgressRing, Tooltip } from "@read-aware/ui";
import { useState } from "react";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import {
  dismissSyncErrorNotice,
  isSyncErrorSnoozedAt,
  readSyncErrorDismissedAt,
} from "../../../platform/sync/sync-error-notice";
import { syncNow } from "../../../platform/sync/sync-scheduler";
import { useSyncBacklog, useSyncStatus } from "../hooks/useSyncStatus";
import { shouldShowSyncIndicator } from "../lib/sync-indicator-visibility";
import { syncCycleFraction } from "../lib/sync-progress";
import { SyncProgressDetail } from "./SyncProgressDetail";

const log = createLogger("sync");

export function SyncIndicator() {
  const { t } = useTranslation("settings");
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(() =>
    readSyncErrorDismissedAt(),
  );
  const backlog = useSyncBacklog(open);

  const syncing = status.state === "syncing";
  const failed = status.state === "error";
  const errorSnoozed = failed && isSyncErrorSnoozedAt(dismissedAt);
  // `open` keeps the chip mounted through the end of a cycle — a popover the
  // user is reading must not vanish because the sync finished under it. It
  // never overrides the account/first-success error policy, though.
  if (!shouldShowSyncIndicator(status, open, errorSnoozed)) return null;

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
        onOpenChange={setOpen}
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
          <SyncProgressDetail status={status} backlog={backlog} />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() => {
                void syncNow().catch((error) => {
                  // The status snapshot already flipped to "error"; the popover
                  // renders it — no toast needed from up here.
                  log.error("manual sync failed", error);
                });
              }}
            >
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
            onClick={() => {
              setDismissedAt(dismissSyncErrorNotice());
              setOpen(false);
            }}
            className="h-6 w-6 rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
            icon={<X size={12} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      )}
    </span>
  );
}
