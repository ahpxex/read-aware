/**
 * Whole-database backup — a single portable file with everything on this device.
 *
 * One bundle carries the KV layer (settings, preferences, conversations, reading
 * stats…), books, collections, annotations, and the original book files
 * (base64). Ids and keys are preserved, so importing is a non-destructive
 * **merge**: every row is upserted, nothing is deleted, and annotations /
 * collections / progress reconnect to their books. This is the local-first
 * backup/restore story until the encrypted sync relay lands.
 *
 * Scope: all user data as today's projections + KV. It does not capture the raw
 * `events` log or device identity — those aren't user data (and the event log is
 * empty until the event-sourced write path exists).
 *
 * Scale note: the whole thing (incl. book bytes) is held in memory as one JSON
 * string. Fine for a personal shelf; a very large library would want a streamed
 * archive instead — revisit if that becomes real.
 */
import { dumpLocalKV, restoreLocalKV } from "../../../platform/local-store";
import {
  getStoredBookBlob,
  listCollections,
  listLibraryBooks,
  restoreCollection,
  restoreLibraryBook,
} from "../../library/lib/library-db";
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import { listAnnotations, saveAnnotation } from "../../annotations/lib/annotation-db";
import type { Annotation } from "../../annotations/lib/annotation-types";

export const BACKUP_VERSION = 1;

// Machine-local bookkeeping — never travels in a portable backup.
const EXCLUDED_KV_KEYS = new Set(["read-aware-migrated-v1"]);

type Backup = {
  app: "read-aware";
  kind: "backup";
  version: number;
  exportedAt: string;
  kv: Record<string, string>;
  books: LibraryBook[];
  collections: Collection[];
  annotations: Annotation[];
  /** bookId -> base64 of the original source file. */
  files: Record<string, string>;
};

export type BackupImportResult = {
  settings: number;
  books: number;
  annotations: number;
  collections: number;
};

// Chunked base64 so multi-MB book files don't blow the call-stack arg limit.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Serialize the entire device-local database into one portable JSON string. */
export async function exportBackup(): Promise<string> {
  const [kvAll, books, collections, annotations] = await Promise.all([
    dumpLocalKV(),
    listLibraryBooks(),
    listCollections(),
    listAnnotations(),
  ]);

  const kv: Record<string, string> = {};
  for (const [key, value] of Object.entries(kvAll)) {
    if (!EXCLUDED_KV_KEYS.has(key)) kv[key] = value;
  }

  const files: Record<string, string> = {};
  for (const book of books) {
    const blob = await getStoredBookBlob(book.id);
    if (blob) files[book.id] = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  const backup: Backup = {
    app: "read-aware",
    kind: "backup",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    kv,
    books,
    collections,
    annotations,
    files,
  };
  return JSON.stringify(backup);
}

/**
 * Merge a previously-exported backup into the current data. Upserts by key/id
 * (non-destructive: existing rows are overwritten, nothing is deleted).
 * Returns how many of each were restored.
 */
export async function importBackup(json: string): Promise<BackupImportResult> {
  const parsed = JSON.parse(json) as Partial<Backup>;
  if (!parsed || parsed.kind !== "backup" || !Array.isArray(parsed.books)) {
    throw new Error("This file is not a ReadAware backup.");
  }

  const files = (parsed.files ?? {}) as Record<string, string>;
  const kv = (parsed.kv ?? {}) as Record<string, string>;
  const collections = parsed.collections ?? [];
  const annotations = parsed.annotations ?? [];

  await restoreLocalKV(kv);
  // Collections first so book membership resolves against existing rows.
  for (const collection of collections) await restoreCollection(collection);
  for (const book of parsed.books) {
    const encoded = files[book.id];
    await restoreLibraryBook(book, encoded ? base64ToBytes(encoded) : null);
  }
  for (const annotation of annotations) await saveAnnotation(annotation);

  return {
    settings: Object.keys(kv).length,
    books: parsed.books.length,
    annotations: annotations.length,
    collections: collections.length,
  };
}
