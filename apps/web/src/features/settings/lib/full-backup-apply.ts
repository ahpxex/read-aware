import { causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { errorCode } from "@read-aware/core";
import { Channel, invoke } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { withSyncBackup } from "../../../platform/sync/sync-scheduler";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";
import type { BackupProgramChoice } from "../../plugins/runtime/backup-program-review";
import type { BackupProgramResult } from "./full-backup-program-migration";
import type { FullBackupImportProgress } from "./full-backup-import-task";
import { withBackupCapture } from "./backup-capture";

export type BackupCredentialChoice = "sourceLocal" | "sourceRoaming" | "targetLocal" | "targetRoaming";
export type FullBackupRestoreRequest = {
  files: Record<string, "source" | "target">;
  programs: Record<string, BackupProgramChoice>;
  programResults: Record<string, BackupProgramResult>;
  credentials: Record<string, BackupCredentialChoice>;
};
export type FullBackupRestoreReceipt = {
  format: 2;
  restoreId: string;
  domainRows: number;
  files: number;
  plugins: number;
  credentials: number;
  cleanupPending: boolean;
};
export type FullBackupApplyReceipt = FullBackupRestoreReceipt & { taskId: string };

/** A committed restore invalidates every mounted store. Keep the existing
 * write/capture reservations until this document reloads, while returning the
 * physical decision to the result dialog. Cancellation cannot reopen old actors.
 * An unfinished rollback needs the same protection until startup recovery. */
export function applyFullBackup(
  taskId: string,
  request: FullBackupRestoreRequest,
  onProgress: (progress: FullBackupImportProgress) => void,
  signal?: AbortSignal,
  origin: DomainActor = "user",
): Promise<FullBackupApplyReceipt> {
  origin = causalActor(origin);
  return new Promise((resolve, reject) => {
    const untilReload = () => new Promise<never>(() => {});
    const stopPlugins = async () => {
      try {
        const { shutdownPlugins } = await import("../../plugins/runtime/plugin-host");
        await shutdownPlugins(undefined, origin);
      } catch (error) {
        createLogger("backup-import").error("Plugin shutdown failed; writes remain paused until reload", error);
      }
    };
    void withSyncBackup(
      () =>
        withPluginDataBackup(
          "import",
          () =>
            withBackupCapture(async () => {
              const progress = new Channel<FullBackupImportProgress>();
              progress.onmessage = onProgress;
              let receipt: FullBackupApplyReceipt;
              try {
                receipt = await invoke("backup_import_apply", { taskId, request, progress });
              } catch (error) {
                if (errorCode(error) !== "backup/recovery-required") throw error;
                reject(error);
                await stopPlugins();
                return untilReload();
              }
              resolve(stampEventCause(receipt, origin));
              await stopPlugins();
              return untilReload();
            }, signal),
          signal,
        ),
      signal,
    ).catch(reject);
  });
}
