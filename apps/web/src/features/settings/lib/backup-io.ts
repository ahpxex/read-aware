/**
 * Legacy v1 subset: KV, books, collections, annotations and locally available
 * original files. The profile summary occupies its legacy KV wire key but is
 * read/restored through the event projection, not raw KV. Other profile fields,
 * entities, independent chats, memories, plugin documents, secrets and
 * the event log are NOT included. This is not a whole-device backup.
 * Import upserts preserved keys/IDs and may overwrite existing records; its
 * sequential writes are not transactional. Boot-time genesis reconciles new
 * restored rows, not the missing event history. The full JSON/base64 bundle
 * remains in memory; native file transport does not make this a streamed archive.
 */
import { dumpLocalKV, restoreLocalKV } from "../../../platform/local-store";
import { LEGACY_PROFILE_KEY, readUserProfileSnapshot, restoreUserProfile } from "../../../domain/user-profile";
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
const EXCLUDED_KV_KEYS = new Set(["read-aware-migrated-v1", LEGACY_PROFILE_KEY]);

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

/** Serialize the v1 backup subset into one portable JSON string. */
export async function exportBackup(): Promise<string> {
  const [kvAll, books, collections, annotations, profile] = await Promise.all([
    dumpLocalKV(),
    listLibraryBooks(),
    listCollections(),
    listAnnotations(),
    readUserProfileSnapshot(),
  ]);

  const kv: Record<string, string> = {};
  for (const [key, value] of Object.entries(kvAll)) {
    if (!EXCLUDED_KV_KEYS.has(key)) kv[key] = value;
  }
  if (profile.summary !== null) kv[LEGACY_PROFILE_KEY] = profile.summary;

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
 * (existing rows can be overwritten; a later failure does not roll back prior writes).
 * Returns how many of each were restored.
 */
export async function importBackup(json: string): Promise<BackupImportResult> {
  const parsed = JSON.parse(json) as Partial<Backup>;
  if (!parsed || parsed.kind !== "backup" || !Array.isArray(parsed.books)) {
    throw new Error("This file is not a ReadAware backup.");
  }

  const files = (parsed.files ?? {}) as Record<string, string>;
  const kv = { ...(parsed.kv ?? {}) } as Record<string, string>;
  const settings = Object.keys(kv).length;
  const hasProfile = Object.hasOwn(kv, LEGACY_PROFILE_KEY);
  const summary = kv[LEGACY_PROFILE_KEY];
  if (hasProfile && typeof summary !== "string") throw new Error("Invalid backup profile summary");
  delete kv[LEGACY_PROFILE_KEY];
  const profile = hasProfile ? await readUserProfileSnapshot() : null;
  const collections = parsed.collections ?? [];
  const annotations = parsed.annotations ?? [];

  await restoreLocalKV(kv);
  if (profile) await restoreUserProfile(summary!, profile.revision);
  // Collections first so book membership resolves against existing rows.
  for (const collection of collections) await restoreCollection(collection);
  for (const book of parsed.books) {
    const encoded = files[book.id];
    await restoreLibraryBook(book, encoded ? base64ToBytes(encoded) : null);
  }
  for (const annotation of annotations) await saveAnnotation(annotation);

  return {
    settings,
    books: parsed.books.length,
    annotations: annotations.length,
    collections: collections.length,
  };
}
