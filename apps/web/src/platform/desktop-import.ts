/**
 * One-time migration of pre-SQLite desktop data.
 *
 * The shipping desktop app used to persist to the webview's own localStorage +
 * IndexedDB. On the first launch after SQLite lands, this best-effort importer
 * sweeps that in-webview data into SQLite (via the Rust commands) so nothing is
 * lost. It runs inside `hydrateLocalStore()` — before the app mounts — and is
 * gated by the `read-aware-migrated-v1` flag so it happens exactly once.
 *
 * Reads the OLD stores directly (raw localStorage / IndexedDB), because the
 * feature modules now resolve to SQLite on desktop and would no longer see them.
 * Desktop-only: `hydrateLocalStore()` only calls this under Tauri.
 */
import { invoke } from "@tauri-apps/api/core";
import { putDesktopBlob } from "./blob-store";

const MIGRATED_FLAG = "read-aware-migrated-v1";
const AI_CONFIG_KEY = "read-aware-ai-config";
const AI_KEY_KEY = "read-aware-ai-key";

const LIBRARY_DB = "read-aware-library";
const ANNOTATIONS_DB = "read-aware-annotations";

async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (!indexedDB.databases) return true; // can't enumerate — attempt anyway
  try {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === name);
  } catch {
    return true;
  }
}

/** Open an existing IndexedDB at its current version (no upgrade), or null. */
async function openExistingIdb(name: string): Promise<IDBDatabase | null> {
  if (!(await databaseExists(name))) return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`Unable to open ${name}.`));
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(store, "readonly");
    } catch {
      resolve([]); // store doesn't exist in this DB
      return;
    }
    const req = transaction.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error(`getAll(${store}) failed.`));
  });
}

/** Copy `read-aware-*` localStorage keys into SQLite `app_kv`. */
async function importLocalStorage(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith("read-aware-")) keys.push(key);
  }

  for (const key of keys) {
    if (key === MIGRATED_FLAG || key === AI_KEY_KEY) continue;
    const value = localStorage.getItem(key);
    if (value == null) continue;

    if (key === AI_CONFIG_KEY) {
      // Split the legacy combined blob: non-secret fields → SQLite; the API key
      // stays in localStorage (kept out of SQLite until a Keychain path lands).
      try {
        const cfg = JSON.parse(value) as { apiKey?: unknown } & Record<string, unknown>;
        const { apiKey, ...nonSecret } = cfg;
        await invoke("set_kv", { key: AI_CONFIG_KEY, value: JSON.stringify(nonSecret) });
        if (typeof apiKey === "string" && apiKey) localStorage.setItem(AI_KEY_KEY, apiKey);
      } catch {
        // Malformed — skip.
      }
      continue;
    }

    await invoke("set_kv", { key, value });
  }
}

/** Move the IndexedDB library (books + files + collections) into SQLite. */
async function importLibrary(): Promise<void> {
  const db = await openExistingIdb(LIBRARY_DB);
  if (!db) return;
  try {
    const collections = await idbGetAll<Record<string, unknown>>(db, "collections");
    for (const collection of collections) {
      await invoke("library_put_collection", { collection });
    }

    const books = await idbGetAll<Record<string, unknown>>(db, "books");
    for (const book of books) {
      await invoke("library_put_book", { book });
    }

    const files = await idbGetAll<{ bookId?: string; blob?: Blob }>(db, "files");
    for (const file of files) {
      if (!file?.bookId || !file.blob) continue;
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      await putDesktopBlob(`bookfile:${file.bookId}`, bytes);
    }
  } finally {
    db.close();
  }
}

/** Move the IndexedDB annotations (highlights + notes) into SQLite. */
async function importAnnotations(): Promise<void> {
  const db = await openExistingIdb(ANNOTATIONS_DB);
  if (!db) return;
  try {
    const annotations = await idbGetAll<{ type?: string }>(db, "annotations");
    for (const annotation of annotations) {
      // Only highlights/notes are modeled today; skip legacy ai-chat rows.
      if (annotation.type !== "highlight" && annotation.type !== "note") continue;
      await invoke("annotation_put", { annotation });
    }
  } finally {
    db.close();
  }
}

/**
 * Run the one-time import, then set the migrated flag. All writes are upserts,
 * so a retry after a partial failure (the flag isn't set unless this resolves)
 * is safe.
 */
export async function importDesktopDataIntoSqlite(): Promise<void> {
  await importLocalStorage();
  await importLibrary();
  await importAnnotations();
  await invoke("set_kv", { key: MIGRATED_FLAG, value: "1" });
}

const MEMORIES_DB = "read-aware-memories";

/**
 * Second-wave one-time import (own flag in local-store): agent memories moved
 * from webview IndexedDB to the SQLite `memories` table after v1 shipped.
 * Upserts, so retry-after-partial-failure is safe.
 */
export async function importWebviewMemoriesIntoSqlite(): Promise<void> {
  const db = await openExistingIdb(MEMORIES_DB);
  if (!db) return;
  try {
    const memories = await idbGetAll<Record<string, unknown>>(db, "memories");
    for (const memory of memories) {
      await invoke("memory_put", { memory });
    }
  } finally {
    db.close();
  }
}
