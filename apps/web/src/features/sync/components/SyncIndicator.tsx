/**
 * Header sync indicator — lives in the same leading-status slot as the
 * update indicator, and follows its manners: invisible until there is
 * something to say (a cycle running, or a failure), a quiet ghost chip when
 * there is. Clicking opens the detailed progress popover instead of acting
 * directly — sync has no one-shot action the way "install update" does.
 */
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Button, Popover, ProgressRing } from "@read-aware/ui";
import { useState } from "react";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { syncNow } from "../../../platform/sync/sync-scheduler";
import { useSyncBacklog, useSyncStatus } from "../hooks/useSyncStatus";
import { syncCycleFraction } from "../lib/sync-progress";
import { SyncProgressDetail } from "./SyncProgressDetail";

const log = createLogger("sync");

export function SyncIndicator() {
  const { t } = useTranslation("settings");
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const backlog = useSyncBacklog(open);

  const syncing = status.state === "syncing";
  const failed = status.state === "error";
  // `open` keeps the chip mounted through the end of a cycle — a popover the
  // user is reading must not vanish because the sync finished under it.
  if (!syncing && !failed && !open) return null;

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
  );
}
