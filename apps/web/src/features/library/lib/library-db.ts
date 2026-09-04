import { invoke } from "../../../platform/ipc";
import type { EventOrigin } from "@read-aware/core";
import {
  getDesktopBlob,
  getDesktopBlobInfo,
  openDesktopBlobFile,
  putDesktopBlob,
} from "../../../platform/blob-store";
import { commitDomainEvents } from "../../../platform/domain-events";
import { fetchRemoteBlob } from "../../../platform/sync/sync-scheduler";
import type {
  BookProgress,
  Collection,
  LibraryBook,
  LibraryBookRow,
  ReadingStatus,
} from "./library-types";
import { withCoverUrl } from "./book-cover-url";
import { isTauri } from "../../../platform/environment";
import type { BookFileSource } from "../../reader/lib/reader-types";
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
// `putBookRecord` survives for the one path that legitimately bypasses the
// log: restoring a backup verbatim (genesis synthesizes its events at next boot).
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

async function putBookRecord(book: LibraryBook): Promise<void> {
  assertDesktop("Saving a book");
  await invoke("library_put_book", { book });
}

async function deleteBookRecords(bookIds: string[], origin?: EventOrigin): Promise<void> {
  if (bookIds.length === 0) return;
  assertDesktop("Removing books");
  // `book.removed` drops the row and its annotations on apply; the blobs
  // (file + cover) are object-storage content and are released separately.
  await commitDomainEvents(
    ...bookIds.map((bookId) => ({ type: "book.removed" as const, payload: { bookId }, origin })),
  );
  await invoke("library_release_book_files", { ids: bookIds });
  for (const bookId of bookIds) emitAppEvent("book-removed", { bookId });
}

async function getAllCollectionRecords(): Promise<Collection[]> {
  if (!isTauri()) return [];
  return invoke<Collection[]>("library_list_collections");
}

async function putCollectionRecord(collection: Collection): Promise<void> {
  assertDesktop("Saving a collection");
  await invoke("library_put_collection", { collection });
}

// --- Pure helpers (backend-agnostic) ----------------------------------------

function clampProgressPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getReadingStatus(progressPercent: number): ReadingStatus {
  if (progressPercent >= 100) return "finished";
  if (progressPercent > 0) return "reading";
  return "unread";
}

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
  input: { title: string; author?: string },
  origin?: EventOrigin,
): Promise<LibraryBook> {
  assertDesktop("Adding a virtual book");
  const bookId = crypto.randomUUID();
  await commitDomainEvents(
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
  );
  const stored = await getBookRecord(bookId);
  if (!stored) throw new Error("Virtual book was not persisted");
  return stored;
}

export async function updateVirtualLibraryBookTitle(
  bookId: string,
  title: string,
  author?: string,
  origin?: EventOrigin,
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
export type BookFileMissingReason =
  | "no-sync"
  | "not-on-relay"
  | "unauthenticated"
  | "unreachable"
  | "undecodable";

export type StoredBookFileResult =
  | { status: "ok"; file: BookFileSource }
  | { status: "missing"; reason: BookFileMissingReason };

/** Pull a book's bytes off the relay into the local store, mapping the typed
 *  fetch outcome onto the reader-facing missing reasons. */
async function fetchBookFile(bookId: string): Promise<{ ok: true } | { ok: false; reason: BookFileMissingReason }> {
  const fetched = await fetchRemoteBlob(bookFileKey(bookId));
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

export async function getStoredBookBlob(bookId: string): Promise<Blob | null> {
  if (!isTauri()) return null;
  let bytes = await getDesktopBlob(bookFileKey(bookId));
  // Not on this device — the new-device bootstrap case: the manifest row came
  // from replaying `book.imported`, the bytes live on the relay. Lazy-fetch
  // decrypts into the local store, so this path runs once per book.
  if (!bytes && (await fetchBookFile(bookId)).ok) {
    bytes = await getDesktopBlob(bookFileKey(bookId));
  }
  return bytes ? new Blob([bytes]) : null;
}

type BookFileRef = Pick<LibraryBook, "id" | "format" | "fileName" | "mimeType">;

/**
 * The book's file from THIS device's store, or null when the bytes are not
 * here. Never touches the network — background work (the engine cover job)
 * must not drag a whole book off the relay just to paint a tile.
 *
 * The blob is always wrapped back into a named `File`: foliate's `makeBook`
 * picks the loader for ZIP containers from the file NAME (a `.cbz` comic and a
 * `.fbz` FictionBook are both zips), so a nameless blob would be read as an
 * EPUB — and, before that, crash on `name.endsWith`.
 */
export async function openLocalBookFile(book: BookFileRef): Promise<BookFileSource | null> {
  if (!isTauri()) return null;
  if (book.format === "pdf") {
    // File-backed so PDFs keep their random-access path.
    return openDesktopBlobFile(
      bookFileKey(book.id),
      book.fileName,
      book.mimeType || "application/pdf",
    );
  }
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
 * PDFs stay file-backed and random-access; the other parsers still receive a
 * whole-file blob until they expose the same structural range contract end to
 * end. Falls back to a relay fetch when the bytes are not local.
 */
export async function resolveStoredBookFile(
  bookOrId: BookFileRef | string,
): Promise<StoredBookFileResult> {
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
  return pulled
    ? { status: "ok", file: pulled }
    : { status: "missing", reason: "unreachable" };
}

export async function getStoredBookFile(
  bookOrId: BookFileRef | string,
): Promise<BookFileSource | null> {
  const resolved = await resolveStoredBookFile(bookOrId);
  return resolved.status === "ok" ? resolved.file : null;
}

export async function updateLibraryBookProgress(bookId: string, progress: BookProgress) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const progressPercent = progress ? clampProgressPercent(progress.progressPercent) : existingBook.progressPercent;
  await commitDomainEvents({
    type: "book.progressed",
    payload: {
      bookId,
      locator: progress?.cfi ?? progress?.href ?? "",
      chapterHref: progress?.href ?? undefined,
      currentLocation: progress?.currentLocation,
      totalLocations: progress?.totalLocations,
      progressPercent,
      status: getReadingStatus(progressPercent),
    },
  });
  return getBookRecord(bookId);
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
  origin?: EventOrigin,
): Promise<LibraryBook | null> {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const title = patch.title?.trim();
  const author = patch.author?.trim();
  const nextBook: LibraryBook = {
    ...existingBook,
    title: title || existingBook.title,
    author: author || existingBook.author,
    updatedAt: new Date().toISOString(),
  };

  if (nextBook.title === existingBook.title && nextBook.author === existingBook.author) {
    return existingBook;
  }
  await commitDomainEvents({
    type: "book.metadataEdited",
    payload: {
      bookId,
      ...(nextBook.title !== existingBook.title ? { title: nextBook.title } : {}),
      ...(nextBook.author !== existingBook.author ? { author: nextBook.author } : {}),
    },
    origin,
  });
  return getBookRecord(bookId);
}

/**
 * Record the reader's own verdict on whether the book is finished.
 *
 * Distinct from the status `updateLibraryBookProgress` derives from the
 * percentage: this one is sticky, so reading on afterwards does not undo it
 * (see `book.finished` in storage/apply.rs).
 */
export async function setLibraryBookFinished(
  bookId: string,
  finished: boolean,
  origin?: EventOrigin,
) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.finished", payload: { bookId, finished }, origin });
  return getBookRecord(bookId);
}

export async function setLibraryBookStarred(
  bookId: string,
  starred: boolean,
  origin?: EventOrigin,
) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.starred", payload: { bookId, starred }, origin });
  return getBookRecord(bookId);
}

export async function listCollections() {
  const collections = await getAllCollectionRecords();
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCollection(name: string, origin?: EventOrigin): Promise<Collection> {
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

export async function renameCollection(
  id: string,
  name: string,
  origin?: EventOrigin,
): Promise<Collection | null> {
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
export async function deleteCollection(id: string, origin?: EventOrigin) {
  assertDesktop("Deleting a collection");
  await commitDomainEvents({
    type: "collection.removed",
    payload: { collectionId: id },
    origin,
  });
}

/** Assign a set of books to a collection (or null to ungroup them). */
export async function setBooksCollection(
  bookIds: string[],
  collectionId: string | null,
  origin?: EventOrigin,
) {
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

export async function removeLibraryBooks(bookIds: string[], origin?: EventOrigin) {
  await deleteBookRecords(bookIds, origin);
}

export async function markLibraryBookOpened(bookId: string) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  await commitDomainEvents({ type: "book.opened", payload: { bookId } });
  return getBookRecord(bookId);
}

export async function removeLibraryBook(bookId: string, origin?: EventOrigin) {
  await deleteBookRecords([bookId], origin);
}

// --- Restore (import a previously-exported bundle; ids preserved) ------------

async function putBookFileBytes(bookId: string, bytes: Uint8Array): Promise<void> {
  assertDesktop("Restoring a book file");
  await putDesktopBlob(bookFileKey(bookId), bytes);
}

/**
 * Upsert a book record verbatim (id preserved) and, if given, its file bytes.
 * Restores deliberately emit no events: rows a backup brings in that the log
 * has never seen get their creation events synthesized by the boot-time
 * genesis reconciliation (platform/event-genesis.ts) on the next launch.
 * Cover state is decided by the store (a cover blob present on this device,
 * or a pre-v24 inline data URL the backup still carries); otherwise the book
 * starts `unchecked` and the engine job re-extracts from the restored file.
 */
export async function restoreLibraryBook(
  book: LibraryBook,
  fileBytes: Uint8Array | null,
): Promise<void> {
  await putBookRecord(book);
  if (fileBytes) await putBookFileBytes(book.id, fileBytes);
}

/** Upsert a collection record verbatim (id preserved). */
export async function restoreCollection(collection: Collection): Promise<void> {
  await putCollectionRecord(collection);
}
