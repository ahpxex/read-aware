import { invoke } from "../platform/ipc";
import { AppError } from "@read-aware/core";
import { classifySyncError } from "../platform/sync/classify-sync-error";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { getSyncConnectionBusy, getSyncConnectionOperationRevision, subscribeSyncConnectionBusy } from "../platform/sync/connection-operation";
import { getSyncConnectionGeneration, getSyncStatusSnapshot, subscribeSyncStatus, syncNow, syncRelayClient } from "../platform/sync/sync-scheduler";
import { HostSyncService } from "./sync-controller";
import { SyncFlowController } from "./sync-flow-controller";
import { listSyncTransports } from "../platform/sync/transport-registry";
import { contributionText } from "../features/plugins/lib/plugin-i18n";
import { workspace } from "./workspace";

const log = createLogger("sync-service");
async function remote<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    log.warn("Sync service request failed", error);
    if (error instanceof AppError) throw new AppError(error.code, "Sync request failed", { retryable: error.retryable });
    throw new AppError(classifySyncError(error) ?? "sync/server", "Sync request failed");
  }
}
export const hostSyncFlows = new SyncFlowController(signal => workspace.navigate({ surface: "settings", section: "dataSync" }, undefined, signal), getSyncConnectionGeneration);
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
  connectionOptions: async () => listSyncTransports().map(({ ref, label }) => ({ ref, label: contributionText(label) })),
  requestFlow: async (request, signal) => {
    try { return await remote(() => hostSyncFlows.request(request, signal)); }
    catch (error) { signal?.throwIfAborted(); throw error; }
  },
}, error => log.warn("Sync observer failed", error));
