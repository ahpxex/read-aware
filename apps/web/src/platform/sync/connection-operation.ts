/**
 * Process-wide serialization for account-connection commands.
 *
 * This deliberately lives outside React: Settings panels can unmount while a
 * relay request, KDF, or Tauri account-adoption command is still running. A
 * hook-local ref would disappear with the panel and let a newly mounted panel
 * start a second persistence flow over the same session/master-key slots.
 */

let operationInFlight = false;
const listeners = new Set<() => void>();

export class SyncConnectionBusyError extends Error {
  constructor() {
    super("a sync connection operation is already in progress");
    this.name = "SyncConnectionBusyError";
  }
}

export function getSyncConnectionBusy(): boolean {
  return operationInFlight;
}

export function subscribeSyncConnectionBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setOperationInFlight(next: boolean): void {
  operationInFlight = next;
  for (const listener of listeners) listener();
}

/** Run one credential/account operation; reject rather than queue duplicates. */
export async function runSyncConnectionOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (operationInFlight) throw new SyncConnectionBusyError();
  setOperationInFlight(true);
  try {
    return await operation();
  } finally {
    setOperationInFlight(false);
  }
}
