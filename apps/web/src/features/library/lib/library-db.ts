import { actorOrigin, type DomainActor } from "../../../platform/domain-actor";
import { runDomainWrite } from "../../../platform/domain-write-gate";
import { invoke } from "../../../platform/ipc";
import {
  AppError,
  normalizeBookRemovalCleanupQuery,
  type BookRemovalCleanupPage,
  type BookRemovalCleanupQuery,
} from "@read-aware/core";
import { removeBookBatch, releaseRemovedBookFiles } from "./book-removal";
import { createLogger } from "../../../platform/logger";
import { getDesktopBlob, getDesktopBlobInfo, openDesktopBlobFile } from "../../../platform/blob-store";
import { openBookArchive } from "../../../platform/book-archive";
import { openPalmRecords } from "../../../platform/palm-records";
import { commitBoundVirtualBook, type VirtualBookBinding } from "../../plugins/lib/virtual-books";
import { commitDomainEvents } from "../../../platform/domain-events";
import { fetchRemoteBlob } from "../../../platform/sync/sync-scheduler";
import type { Collection, LibraryBook, LibraryBookRow } from "./library-types";
import { withCoverUrl } from "./book-cover-url";
import { bookMetadataPatch } from "./book-metadata-patch";
import { isTauri } from "../../../platform/environment";
import type { StoredBookSource } from "../../reader/lib/reader-types";
import { emitAppEvent } from "../../../platform/app-events";

/** Blob-store key for a book's original file bytes. */
export const bookFileKey = (bookId: string) => `bookfile:${bookId}`;

// --- Storage primitives ------------------------------------------------------
// Desktop-only: native SQLite (Rust commands) + blob store. The browser build
// is a pure UI shell (Storybook feeds components fixture props) — reads come
// back empty so surfaces render their empty states, writes throw instead of
// pretending to persist.
//
// WRITES GO THROUGH EVENTS. `commitDomainEvents` appends to the log and applies
// the projection in one SQLite transaction, then these functions read the row
// back — the store decides what was persisted, this module does not predict it.
//
// Import lives in `book-import.ts`; cover/metadata completion by the reading
// engine in `book-enrichment.ts`. Covers are never data URLs here: the row
// carries a status + blob key and the shelf paints `rablob://` URLs.

function assertDesktop(what: string): never | void {
  if (!isTauri()) {
    throw new Error(`${what} is desktop-only — the browser build is a UI shell without storage.`);
  }
}

export async function getAllBookRecords(): Promise<LibraryBook[]> {
  if (!isTauri()) return [];
  return (await invoke<LibraryBookRow[]>("library_load")).map(withCoverUrl);
}

export async function getBookRecord(bookId: string): Promise<LibraryBook | null> {
  if (!isTauri()) return null;
  const row = await invoke<LibraryBookRow | null>("library_get_book", { id: bookId });
  return row ? withCoverUrl(row) : null;
}

async function deleteBookRecords(bookIds: string[], origin?: DomainActor) {
  assertDesktop("Removing books");
  // `book.removed` drops the row and its annotations on apply; the blobs
  // (file + cover) are object-storage content and are released separately.
  return runDomainWrite(() =>
    removeBookBatch(bookIds, {
      commit: (ids) =>
        commitDomainEvents(...ids.map((bookId) => ({ type: "book.removed" as const, payload: { bookId }, origin }))),
      releaseFiles: (ids) => invoke("library_release_book_files", { ids }),
      removed: (bookId) => emitAppEvent("book-removed", { bookId }, origin),
      warn: (error) => createLogger("library").warn("Books removed but local file release failed", error),
    }),
  );
}

async function getAllCollectionRecords(): Promise<Collection[]> {
  if (!isTauri()) return [];
  return invoke<Collection[]>("library_list_collections");
}

// --- Pure helpers (backend-agnostic) ----------------------------------------

export function sortBooks(books: LibraryBook[]) {
  return [...books].sort((left, right) => {
    const leftTime = new Date(left.lastOpenedAt ?? left.updatedAt).getTime();
    const rightTime = new Date(right.lastOpenedAt ?? right.updatedAt).getTime();
    return rightTime - leftTime;
  });
}

// --- Public API --------------------------------------------------------------

/**
 * A plugin-provided (virtual) shelf entry: no blob, content resolved by the
 * plugin's content provider at open time. Its cover verdict is `none` from
 * the start — there is no file for any extractor to inspect.
 */
export async function addVirtualLibraryBook(
  input: { title: string; author?: string; binding: VirtualBookBinding },
  origin?: DomainActor,
  signal?: AbortSignal,
): Promise<LibraryBook> {
  assertDesktop("Adding a virtual book");
  if (actorOrigin(origin ?? "user") !== `plugin:${input.binding.pluginId}`)
    throw new AppError("plugin/unavailable", "Virtual book owner mismatch");
  const bookId = crypto.randomUUID();
  await commitBoundVirtualBook(
    bookId,
    input.binding,
    [
      {
        type: "book.imported",
        payload: {
          bookId,
          title: input.title.trim() || "Untitled",
          author: input.author?.trim() || "",
          format: "virtual",
          fileName: "",
          fileSize: 0,
          sourceBlobKey: "",
        },
        origin,
      },
      { type: "book.coverExtracted", payload: { bookId, status: "none" }, origin },
    ],
    signal,
  );
  const stored = await getBookRecord(bookId);
  if (!stored) throw new Error("Virtual book was not persisted");
  return stored;
}

export async function updateVirtualLibraryBookTitle(
  bookId: string,
  title: string,
  author?: string,
  origin?: DomainActor,
): Promise<void> {
  const book = await getBookRecord(bookId);
  if (!book || book.format !== "virtual") return;
  await commitDomainEvents({
    type: "book.metadataEdited",
    payload: { bookId, title, ...(author !== undefined ? { author } : {}) },
    origin,
  });
}

export async function listLibraryBooks() {
  return sortBooks(await getAllBookRecords());
}

/**
 * Why a book's file isn't openable on this device — the reader's error surface
 * owes each cause different words and a different next step:
 * - `no-sync`         this device can't ask the relay (sync off / signed out);
 *                     re-importing the file is the only route.
 * - `not-on-relay`    the relay answered: it has no bytes. The importing
 *                     device never (successfully) uploaded them.
 * - `unauthenticated` the session died — signing in again may be all it takes.
 * - `unreachable`     the ask failed in transit (offline, wrong server, 5xx) —
 *                     retrying can genuinely succeed.
 * - `undecodable`     ciphertext came back but this passphrase can't open it.
 */
export type BookFileMissingReason = "no-sync" | "not-on-relay" | "unauthenticated" | "unreachable" | "undecodable";

export type StoredBookFileResult =
  | { status: "ok"; file: StoredBookSource }
  | { status: "missing"; reason: BookFileMissingReason };

/** Pull a book's bytes off the relay into the local store, mapping the typed
 *  fetch outcome onto the reader-facing missing reasons. */
async function fetchBookFile(
  bookId: string,
  fetchBlob = fetchRemoteBlob,
): Promise<{ ok: true } | { ok: false; reason: BookFileMissingReason }> {
  const fetched = await fetchBlob(bookFileKey(bookId));
  switch (fetched.outcome) {
    case "fetched":
      return { ok: true };
    case "unavailable":
      return { ok: false, reason: "no-sync" };
    case "missing":
      return { ok: false, reason: "not-on-relay" };
    case "failed":
      return {
        ok: false,
        reason:
          fetched.reason === "unauthenticated"
            ? "unauthenticated"
            : fetched.reason === "undecodable"
              ? "undecodable"
              : "unreachable",
      };
  }
}

type BookFileRef = Pick<LibraryBook, "id" | "format" | "fileName" | "mimeType">;

/**
 * ZIP containers the shell reads where they are stored, with the media type
 * that tells the engine which one it is when the stored name does not.
 */
const ARCHIVE_FORMATS: Partial<Record<LibraryBook["format"], string>> = {
  epub: "application/epub+zip",
  cbz: "application/vnd.comicbook+zip",
};
/** Palm databases, which the shell reads the same way: records, text and resources on request. */
const PALM_FORMATS: ReadonlySet<LibraryBook["format"]> = new Set(["mobi", "azw3"]);

/**
 * The book's file from THIS device's store, or null when the bytes are not
 * here. Never touches the network — background work (the engine cover job)
 * must not drag a whole book off the relay just to paint a tile.
 *
 * A whole-file blob is always wrapped back into a named `File`: foliate's
 * `makeBook` picks the loader for ZIP containers from the file NAME (a `.fbz`
 * FictionBook is a zip too), so a nameless blob would be read as an EPUB —
 * and, before that, crash on `name.endsWith`.
 */
export async function openLocalBookFile(book: BookFileRef): Promise<StoredBookSource | null> {
  if (!isTauri()) return null;
  if (book.format === "pdf") {
    // File-backed so PDFs keep their random-access path.
    return openDesktopBlobFile(bookFileKey(book.id), book.fileName, book.mimeType || "application/pdf");
  }
  // The archive never enters the webview: the engine is given its directory
  // and the documents it parses, and a page loads its images and fonts by URL.
  const archiveType = ARCHIVE_FORMATS[book.format];
  if (archiveType) return openBookArchive(book.id, book.fileName, archiveType);
  if (PALM_FORMATS.has(book.format))
    return openPalmRecords(book.id, book.fileName, book.mimeType || "application/x-mobipocket-ebook");
  const bytes = await getDesktopBlob(bookFileKey(book.id));
  if (!bytes) return null;
  return new File([bytes], book.fileName, { type: book.mimeType || "" });
}

/** Whether the book's file bytes are on this device. */
export async function hasLocalBookFile(bookId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return (await getDesktopBlobInfo(bookFileKey(bookId))) !== null;
}

/**
 * Reader source for an imported book, with the missing-file cause attached.
 * PDFs stay file-backed and random-access; ZIP archives (EPUB, CBZ) and Palm
 * databases (MOBI, AZW3) are read by the shell; the remaining formats (FB2,
 * CBR, text, HTML) are single documents their parsers take whole. Falls back to a relay fetch when the
 * bytes are not local.
 */
export async function resolveStoredBookFile(bookOrId: BookFileRef | string): Promise<StoredBookFileResult> {
  if (!isTauri()) return { status: "missing", reason: "no-sync" };
  const book = typeof bookOrId === "string" ? await getBookRecord(bookOrId) : bookOrId;
  if (!book) return { status: "missing", reason: "no-sync" };

  const local = await openLocalBookFile(book);
  if (local) return { status: "ok", file: local };
  const fetched = await fetchBookFile(book.id);
  if (!fetched.ok) return { status: "missing", reason: fetched.reason };
  const pulled = await openLocalBookFile(book);
  // A successful fetch that still opens nothing means the local write raced a
  // wipe — treat as unreachable so the user retries rather than re-imports.
  return pulled ? { status: "ok", file: pulled } : { status: "missing", reason: "unreachable" };
}

export async function getStoredBookFile(bookOrId: BookFileRef | string): Promise<StoredBookSource | null> {
  const resolved = await resolveStoredBookFile(bookOrId);
  return resolved.status === "ok" ? resolved.file : null;
}

/**
 * Update user-editable metadata (title/author). Empty input keeps the current
 * value rather than blanking the field. Bumps `updatedAt` (a real modification)
 * but not `lastOpenedAt`, so a metadata fix doesn't masquerade as a reading
 * session. Uses only existing columns — no schema change.
 */
export async function updateBookMetadata(
  bookId: string,
  patch: { title?: string; author?: string },
  origin?: DomainActor,
): Promise<LibraryBook | null> {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const changes = bookMetadataPatch(existingBook, patch);
  if (Object.keys(changes).length === 0) {
    return existingBook;
  }
  await commitDomainEvents({
    type: "book.metadataEdited",
    payload: {
      bookId,
      ...changes,
    },
    origin,
  });
  return getBookRecord(bookId);
}

/**
 * Record the reader's own verdict on whether the book is finished.
 *
 * Distinct from the status a reading session derives from the
 * percentage: this one is sticky, so reading on afterwards does not undo it
 * (see `book.finished` in storage/apply.rs).
 */
export async function setLibraryBookFinished(bookId: string, finished: boolean, origin?: DomainActor) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.finished", payload: { bookId, finished }, origin });
  return getBookRecord(bookId);
}

export async function setLibraryBookStarred(bookId: string, starred: boolean, origin?: DomainActor) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.starred", payload: { bookId, starred }, origin });
  return getBookRecord(bookId);
}

export async function listCollections() {
  const collections = await getAllCollectionRecords();
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCollection(name: string, origin?: DomainActor): Promise<Collection> {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled collection",
    createdAt: new Date().toISOString(),
  };
  await commitDomainEvents({
    type: "collection.created",
    payload: { collectionId: collection.id, name: collection.name },
    origin,
  });
  return collection;
}

export async function renameCollection(id: string, name: string, origin?: DomainActor): Promise<Collection | null> {
  const existing = (await getAllCollectionRecords()).find((c) => c.id === id);
  if (!existing) return null;

  const next: Collection = { ...existing, name: name.trim() || existing.name };
  await commitDomainEvents({
    type: "collection.renamed",
    payload: { collectionId: id, name: next.name },
    origin,
  });
  return next;
}

/**
 * Delete a collection and clear its books' membership (the books stay).
 * `collection.removed` implies the membership clearing on replay — no per-book
 * `book.removedFromCollection` events are emitted for it.
 */
export async function deleteCollection(id: string, origin?: DomainActor) {
  assertDesktop("Deleting a collection");
  await commitDomainEvents({
    type: "collection.removed",
    payload: { collectionId: id },
    origin,
  });
}

/** Assign a set of books to a collection (or null to ungroup them). */
export async function setBooksCollection(bookIds: string[], collectionId: string | null, origin?: DomainActor) {
  if (bookIds.length === 0) return;
  const idSet = new Set(bookIds);
  const all = await getAllBookRecords();
  const affected = all.filter((book) => idSet.has(book.id) && book.collectionId !== collectionId);
  await commitDomainEvents(
    ...affected.map((book) =>
      collectionId
        ? {
            type: "book.addedToCollection" as const,
            payload: { bookId: book.id, collectionId },
            origin,
          }
        : {
            type: "book.removedFromCollection" as const,
            // Ungrouping: the membership being removed is the book's current one.
            payload: { bookId: book.id, collectionId: book.collectionId as string },
            origin,
          },
    ),
  );
}

export async function removeLibraryBooks(bookIds: string[], origin?: DomainActor) {
  return deleteBookRecords(bookIds, origin);
}

export async function retryLibraryBookFileRelease(bookIds: string[]) {
  assertDesktop("Releasing removed book files");
  return runDomainWrite(() =>
    releaseRemovedBookFiles(bookIds, {
      releaseFiles: (ids) => invoke("library_release_book_files", { ids }),
      warn: (error) => createLogger("library").warn("Removed book file release retry failed", error),
    }),
  );
}

export async function listLibraryRemovalCleanup(query?: BookRemovalCleanupQuery): Promise<BookRemovalCleanupPage> {
  const input = normalizeBookRemovalCleanupQuery(query);
  assertDesktop("Listing removed book file cleanup");
  return invoke("library_list_removal_cleanup", input);
}

export async function markLibraryBookOpened(bookId: string, origin?: DomainActor) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.opened", origin, payload: { bookId } });
  return getBookRecord(bookId);
}

export async function removeLibraryBook(bookId: string, origin?: DomainActor) {
  const receipt = await deleteBookRecords([bookId], origin);
  // Preserve the existing single-delete error contract. Batch callers get the
  // committed/cleanup distinction and can retry the same IDs explicitly.
  if (receipt.files.status === "pending")
    throw new AppError(receipt.files.errorCode, "Book removed but local file release failed");
}
