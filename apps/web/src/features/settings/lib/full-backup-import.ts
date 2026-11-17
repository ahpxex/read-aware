import { open } from "@tauri-apps/plugin-dialog";
import { Channel, invoke } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";
import { withSyncBackup } from "../../../platform/sync/sync-scheduler";
import { withBackupCapture } from "./backup-capture";
import {
  createFullBackupImport,
  type BackupSourceReceipt,
  type BackupPlanReceipt,
  type FullBackupImportProgress,
} from "./full-backup-import-task";

import { applyFullBackup } from "./full-backup-apply";

const log = createLogger("full-backup-import");
/** Internal preparation entry. UI/domain choices and atomic application must
 * consume the retained review before the existing import action can switch. */
export const prepareFullBackupImport = createFullBackupImport({
  id: () => crypto.randomUUID(),
  selectSource: () => open({ multiple: false, directory: false, filters: [{ name: "AGE", extensions: ["age"] }] }),
  open: (taskId, source, password, onProgress) => {
    const progress = new Channel<FullBackupImportProgress>();
    progress.onmessage = onProgress;
    return invoke<BackupSourceReceipt>("backup_import_open", { taskId, source, password, progress });
  },
  plan: (taskId, onProgress, signal) =>
    withSyncBackup(
      () =>
        withPluginDataBackup(
          "export",
          () =>
            withBackupCapture(() => {
              signal?.throwIfAborted();
              const progress = new Channel<FullBackupImportProgress>();
              progress.onmessage = onProgress;
              return invoke<BackupPlanReceipt>("backup_import_plan", { taskId, progress });
            }, signal),
          signal,
        ),
      signal,
    ),
  // Planning only reads target data, so it uses the read/capture mode. Normal
  // reading facts are closed first; source data is never applied to the target.
  read: (taskId, query) => invoke("backup_import_review", { taskId, query }),
  stageProgram: (taskId, request) => invoke("backup_import_stage_program", { taskId, request }),
  stageStorage: (taskId, token, query) => invoke("backup_import_stage_storage", { taskId, token, query }),
  apply: applyFullBackup,
  cancel: (taskId) => invoke("backup_import_cancel", { taskId }),
  warn: (message, error) => log.warn(message, error),
});
