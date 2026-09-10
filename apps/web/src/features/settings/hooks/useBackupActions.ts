import { useLayoutEffect, useRef, useState } from "react";
import { AppError, type BackupAction } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { hostBackupFlows, hostMaintenance } from "../../../services/maintenance";
import { backupFileActions, BACKUP_FILENAME } from "../lib/backup-file-actions";
import type { BackupImportResult } from "../lib/backup-io";

const log = createLogger("backup-actions");

export function useBackupActions(blocked = false) {
  const { t } = useTranslation("settings"), { toast } = useToast();
  const [busy, setBusy] = useState(false), [requested, setRequested] = useState<BackupAction | null>(null);
  const active = useRef(false), pending = useRef<BackupAction | null>(null), lifetime = useRef<AbortController | null>(null);
  const unavailable = useRef(blocked); unavailable.current = blocked;
  useLayoutEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const off = hostBackupFlows.bind({
      open: ({ action }) => {
        if (active.current || unavailable.current) throw new AppError("ui/unavailable", "A native data action is already active");
        hostMaintenance.revealControl(`backup-${action}`);
        pending.current = action; setRequested(action);
      },
      close: () => { pending.current = null; setRequested(null); },
    });
    return () => { off(); controller.abort(); };
  }, []);

  const run = async (action: BackupAction) => {
    if (active.current || unavailable.current || pending.current && pending.current !== action) return;
    active.current = true; setBusy(true);
    const owner = lifetime.current;
    let operationSignal: AbortSignal | undefined, restarting = false;
    try {
      const result = await hostBackupFlows.run<boolean | BackupImportResult | null>(action, signal => {
        const combined = signal && owner ? AbortSignal.any([signal, owner.signal]) : signal ?? owner?.signal;
        operationSignal = combined;
        return action === "export" ? backupFileActions.export(combined) : backupFileActions.import(combined);
      });
      if (result && typeof result === "object") {
        restarting = true;
        // Reboot also performs the existing backup genesis reconciliation.
        window.setTimeout(() => window.location.reload(), 900);
      }
      if (!result || owner?.signal.aborted) return;
      toast({ variant: "success", title: t("dataSync.noticeDone"), description: typeof result === "boolean"
        ? t("dataSync.exportSuccess", { file: BACKUP_FILENAME })
        : t("dataSync.merge.summary", {
          books: t("dataSync.merge.books", { count: result.books }), annotations: t("dataSync.merge.annotations", { count: result.annotations }),
          collections: t("dataSync.merge.collections", { count: result.collections }), settings: t("dataSync.merge.settings", { count: result.settings }),
        }) });
    } catch (error) {
      log.error(`Backup ${action} failed`, error);
      if (!owner?.signal.aborted && !operationSignal?.aborted) toast({ variant: "destructive", title: t("dataSync.noticeError"),
        description: t(action === "export" ? "dataSync.exportError" : "dataSync.importError") });
    } finally {
      active.current = restarting; pending.current = null;
      if (!owner?.signal.aborted) { setBusy(restarting); setRequested(null); }
    }
  };
  return { busy, requested, run };
}
