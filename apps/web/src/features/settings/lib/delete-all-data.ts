/**
 * The danger-zone action: delete EVERYTHING on this device — the event log,
 * every projection (books, annotations, memories, chat), blobs, settings,
 * and the sealed secrets with their key. The relay copy of a synced account
 * is deliberately untouched: this wipes A DEVICE, not the account; the
 * caller's copy explains that distinction to the user.
 *
 * Ordering matters:
 *  1. best-effort relay logout while the session secret still exists;
 *  2. the Rust wipe (tables + blobs + secret key, one command);
 *  3. re-arm the one-time import flags — they died with app_kv, and without
 *     them the next boot would "helpfully" re-import the legacy webview data
 *     the user just asked us to destroy;
 *  4. clear the webview's own storage (that same legacy data);
 * then the caller reloads, and boot runs as a fresh install.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../platform/environment";
import { syncRelayClient } from "../../../platform/sync/sync-scheduler";

const ONE_TIME_IMPORT_FLAGS = ["read-aware-migrated-v1", "read-aware-migrated-memories-v1"];

export async function deleteAllData(): Promise<void> {
  if (!isTauri()) {
    throw new Error("Deleting all data is desktop-only — the browser build has no store.");
  }

  try {
    await syncRelayClient().logout();
  } catch {
    // Offline or never connected — the local wipe must proceed regardless.
  }

  await invoke("wipe_all_data");

  for (const flag of ONE_TIME_IMPORT_FLAGS) {
    await invoke("set_kv", { key: flag, value: "1" });
  }

  try {
    localStorage.clear();
    const databases = await indexedDB.databases();
    await Promise.allSettled(
      databases
        .map((db) => db.name)
        .filter((name): name is string => Boolean(name))
        .map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              // Another tab/handle keeping it open must not hang the wipe.
              request.onblocked = () => resolve();
            }),
        ),
    );
  } catch (error) {
    // Legacy webview storage is best-effort: the import flags above already
    // prevent it from ever being read back into SQLite.
    console.warn("[delete-all-data] webview storage cleanup incomplete", error);
  }
}
