import { invoke } from "../platform/ipc";
import { AppError } from "@read-aware/core";
import { classifySyncError } from "../platform/sync/classify-sync-error";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { getSyncConnectionBusy, getSyncConnectionOperationRevision, subscribeSyncConnectionBusy } from "../platform/sync/connection-operation";
import { getSyncConnectionGeneration, getSyncStatusSnapshot, subscribeSyncStatus, syncNow, syncRelayClient } from "../platform/sync/sync-scheduler";
import { HostSyncService } from "./sync-controller";
import { workspace } from "./workspace";

const log = createLogger("sync-service");
async function remote<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    log.warn("Sync service request failed", error);
    throw new AppError(classifySyncError(error) ?? "sync/server", "Sync request failed");
  }
}
export const hostSync = new HostSyncService({
  supported: isTauri, busy: getSyncConnectionBusy,
  epoch: () => `${getSyncConnectionGeneration()}:${getSyncConnectionOperationRevision()}`,
  status: getSyncStatusSnapshot,
  subscribe: handler => {
    const status = subscribeSyncStatus(handler), busy = subscribeSyncConnectionBusy(handler);
    return () => { status(); busy(); };
  },
  backlog: async () => invoke<{ events: number; blobs: number }>("sync_outbox_counts"),
  account: () => remote(() => syncRelayClient().account()),
  run: () => remote(syncNow),
  openSettings: signal => workspace.navigate({ surface: "settings", section: "dataSync" }, undefined, signal),
}, error => log.warn("Sync observer failed", error));
