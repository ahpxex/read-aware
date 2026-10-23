import { AppError } from "@read-aware/core";
import { Channel, invoke } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";
import { withSyncBackup } from "../../../platform/sync/sync-scheduler";
import { withBackupCapture } from "./backup-capture";
import {
  createFullBackupExport,
  type FullBackupCaptureReceipt,
  type FullBackupProgress,
} from "./full-backup-export-task";

const log = createLogger("full-backup-export");

/** Internal host entry; the user-facing password/restore workflow is separate
 * from the existing v1 subset actions. Never expose this through plugin IPC. */
export const exportFullBackup = createFullBackupExport({
  id: () => crypto.randomUUID(),
  // The native side opens the save dialog (readaware-backup.age, AGE filter)
  // and keeps the pick bound to this task; the webview never names a path.
  selectDestination: (taskId) => invoke<string | null>("backup_export_choose_destination", { taskId }),
  capture: (taskId, onProgress, signal) =>
    withSyncBackup(
      (fetchBlob) =>
        withPluginDataBackup(
          "export",
          () =>
            withBackupCapture(async () => {
              signal?.throwIfAborted();
              const progress = new Channel<FullBackupProgress>();
              progress.onmessage = onProgress;
              return invoke<FullBackupCaptureReceipt>("backup_export_capture", { taskId, progress });
            }, signal),
          signal,
          async () => {
            onProgress({ phase: "preparing" });
            const missing = await invoke<string[]>("backup_export_sources");
            for (const key of missing) {
              signal?.throwIfAborted();
              const result = await fetchBlob(key);
              if (result.outcome !== "fetched")
                throw new AppError("backup/incomplete", "A registered backup source is unavailable");
            }
            signal?.throwIfAborted();
          },
        ),
      signal,
    ),
  // iOS picks the destination in the export picker at write time; false there
  // is a cancel, exactly like a null destination choice.
  write: (taskId, password) => invoke<boolean>("backup_export_write", { taskId, password }),
  cancel: (taskId) => invoke("backup_export_cancel", { taskId }),
  warn: (message, error) => log.warn(message, error),
});
