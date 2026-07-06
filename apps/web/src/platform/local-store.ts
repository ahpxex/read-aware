/**
 * The device-local persistence seam.
 *
 * Every `read-aware-*` preference module reads/writes through `localKV` instead
 * of `localStorage` directly. `localKV` mirrors the synchronous `localStorage`
 * interface (`getItem`/`setItem`/`removeItem`) so those modules — and the Jotai
 * atoms that seed synchronously from them at module-eval — need no shape change.
 *
 * Two backings, resolved by `isTauri()`:
 * - **Browser (vite dev / Storybook):** delegate straight to `localStorage`.
 *   No native runtime, fully synchronous, unchanged from before.
 * - **Desktop (Tauri):** an in-memory snapshot hydrated once at boot from the
 *   SQLite `app_kv` table (`load_kv_all`), read synchronously; writes update the
 *   snapshot immediately and persist to SQLite fire-and-forget (`set_kv` /
 *   `delete_kv`) — same write-through feel as `localStorage` had.
 *
 * `hydrateLocalStore()` MUST be awaited before the app module graph (which seeds
 * atoms synchronously) is imported — see main.tsx. Until it resolves under
 * Tauri, the snapshot is empty and reads fall back to defaults.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./environment";
import { importDesktopDataIntoSqlite } from "./desktop-import";
import { reconcileGenesisEvents } from "./event-genesis";

const MIGRATED_FLAG = "read-aware-migrated-v1";

let snapshot: Map<string, string> | null = null;
let hydrated = false;

async function loadKvSnapshot(): Promise<Map<string, string>> {
  const all = await invoke<Record<string, string>>("load_kv_all");
  return new Map(Object.entries(all));
}

/** A `localStorage`-shaped facade over the resolved device-local backing. */
export const localKV = {
  getItem(key: string): string | null {
    if (!isTauri()) return localStorage.getItem(key);
    return snapshot?.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    if (!isTauri()) {
      localStorage.setItem(key, value);
      return;
    }
    (snapshot ??= new Map()).set(key, value);
    void invoke("set_kv", { key, value }).catch((err) => {
      console.error(`[local-store] set_kv failed for "${key}"`, err);
    });
  },

  removeItem(key: string): void {
    if (!isTauri()) {
      localStorage.removeItem(key);
      return;
    }
    snapshot?.delete(key);
    void invoke("delete_kv", { key }).catch((err) => {
      console.error(`[local-store] delete_kv failed for "${key}"`, err);
    });
  },
};

/**
 * Load the SQLite config snapshot before any settings module reads it. No-op in
 * the browser (`localKV` delegates straight to `localStorage`). Idempotent.
 */
export async function hydrateLocalStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!isTauri()) return;

  try {
    snapshot = await loadKvSnapshot();
  } catch (err) {
    console.error("[local-store] hydrate failed; starting from empty config", err);
    snapshot = new Map();
  }

  // First launch after SQLite lands: sweep the old in-webview data into SQLite.
  // Guarded so a failure doesn't block boot — the flag stays unset and it
  // retries next launch; the snapshot keeps whatever app_kv already had.
  if (snapshot && !snapshot.get(MIGRATED_FLAG)) {
    try {
      await importDesktopDataIntoSqlite();
      snapshot = await loadKvSnapshot();
    } catch (err) {
      console.error("[local-store] one-time import failed; will retry next launch", err);
    }
  }

  // Off the boot-critical path: synthesize creation events for projection rows
  // the event log has never seen (pre-event-era data, v1 backup restores,
  // dropped best-effort appends). Idempotent; a failure retries next launch.
  void reconcileGenesisEvents().catch((err) => {
    console.error("[local-store] genesis event reconciliation failed", err);
  });
}

/** Snapshot every device-local `read-aware-*` value (for a full-backup export). */
export async function dumpLocalKV(): Promise<Record<string, string>> {
  if (isTauri()) return invoke<Record<string, string>>("load_kv_all");
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith("read-aware-")) {
      const value = localStorage.getItem(key);
      if (value != null) out[key] = value;
    }
  }
  return out;
}

/** Merge KV entries into the device-local store, awaiting durability before reload. */
export async function restoreLocalKV(entries: Record<string, string>): Promise<void> {
  if (isTauri()) {
    for (const [key, value] of Object.entries(entries)) {
      (snapshot ??= new Map()).set(key, value);
      await invoke("set_kv", { key, value });
    }
    return;
  }
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
}
