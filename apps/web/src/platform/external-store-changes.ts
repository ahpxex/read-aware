/**
 * Changes another ReadAware process on this device committed to the library.
 *
 * The `ra` CLI opens the same SQLite store while the app runs. The native
 * store watch (`store_watch.rs`) emits `store-changed-externally` when a
 * different connection committed; nothing else in this process would notice.
 * The refresh mirrors what a sync pull does, plus the parts only a same-device
 * writer needs: the HLC clock moves past the CLI's stamps (it shares this
 * device id) and the KV mirror adopts what it wrote.
 */
import { listen } from "@tauri-apps/api/event";
import { emitAppEvent } from "./app-events";
import { reseedClockFromFrontier } from "./domain-events";
import { isTauri } from "./environment";
import { reloadLocalKVFromStore } from "./local-store";
import { createLogger } from "./logger";
import { refreshRoamingPreferences } from "./roaming-preferences";

const log = createLogger("external-store-changes");

/** The native event name (`store_watch::EVENT`). */
export const STORE_CHANGED_EXTERNALLY = "store-changed-externally";

/** Refresh everything an external commit may have changed. */
export async function refreshAfterExternalCommit(): Promise<void> {
  // Stamps first: any write this refresh triggers must sort after the CLI's.
  await reseedClockFromFrontier();
  const keys = await reloadLocalKVFromStore();
  if (keys.length) log.info("Adopted settings another ReadAware process wrote", { keys: keys.length });
  emitAppEvent("projections-invalidated", { source: "host" });
  emitAppEvent("library-changed", {});
  emitAppEvent("conversations-changed", {});
  await refreshRoamingPreferences();
  emitAppEvent("store-changed-externally", {});
}

/** Subscribe for the app's lifetime; returns the unsubscribe. */
export function watchExternalStoreChanges(): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let running = false;
  let again = false;
  const refresh = async () => {
    // Commits keep arriving while a CLI import runs; coalesce them into at
    // most one refresh in flight and one queued behind it.
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await refreshAfterExternalCommit();
      } while (again && !disposed);
    } catch (error) {
      log.error("Refreshing after another process's commit failed", error);
    } finally {
      running = false;
    }
  };
  const unlisten = listen(STORE_CHANGED_EXTERNALLY, () => {
    if (!disposed) void refresh();
  }).catch((error) => {
    log.error("Subscribing to external library changes failed", error);
    return undefined;
  });
  return () => {
    disposed = true;
    void unlisten
      .then((dispose) => dispose?.())
      .catch((error) => log.warn("Releasing the external library subscription failed", error));
  };
}
