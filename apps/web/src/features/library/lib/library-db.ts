import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { getDesktopBlob, putDesktopBlob } from "../../../platform/blob-store";
import { emitDomainEvents } from "../../../platform/domain-events";
import type {
  BookFormat,
  BookProgress,
  Collection,
  LibraryBook,
  ReadingStatus,
} from "./library-types";
import { extractBookCover, openBookWithMetadata } from "./library-cover";
import { sniffBookFormat } from "./book-format-sniff";
import { isTauri } from "../../../platform/environment";

/** Blob-store key for a book's original file bytes (desktop SQLite backend). */
const bookFileKey = (bookId: string) => `bookfile:${bookId}`;

// --- Storage primitives ------------------------------------------------------
// Desktop-only: native SQLite (Rust commands) + blob store. The browser build
// is a pure UI shell (Storybook feeds components fixture props) — reads come
// back empty so surfaces render their empty states, writes throw instead of
// pretending to persist. Everything below (dedup, cover hydration, sorting) is
// pure and backend-agnostic.

function assertDesktop(what: string): never | void {
  if (!isTauri()) {
    throw new Error(`${what} is desktop-only — the browser build is a UI shell without storage.`);
  }
}

async function getAllBookRecords(): Promise<LibraryBook[]> {
  if (!isTauri()) return [];
  return invoke<LibraryBook[]>("library_load");
}

async function getBookRecord(bookId: string): Promise<LibraryBook | null> {
  if (!isTauri()) return null;
  return (await invoke<LibraryBook | null>("library_get_book", { id: bookId })) ?? null;
}

async function putBookRecord(book: LibraryBook): Promise<void> {
  assertDesktop("Saving a book");
  await invoke("library_put_book", { book });
}

async function storeImportedBook(book: LibraryBook, file: File): Promise<void> {
  assertDesktop("Importing a book");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { sha256 } = await putDesktopBlob(
    bookFileKey(book.id),
    bytes,
    book.mimeType || undefined,
  );
  emitDomainEvents({
    type: "book.imported",
    payload: {
      bookId: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      fileName: book.fileName,
      mimeType: book.mimeType || undefined,
      fileSize: book.fileSize,
      sourceBlobKey: bookFileKey(book.id),
      sourceSha256: sha256,
    },
  });
  await invoke("library_put_book", { book });
}

async function deleteBookRecords(bookIds: string[]): Promise<void> {
  if (bookIds.length === 0) return;
  assertDesktop("Removing books");
  emitDomainEvents(
    ...bookIds.map((bookId) => ({ type: "book.removed" as const, payload: { bookId } })),
  );
  await invoke("library_delete_books", { ids: bookIds });
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

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (segment) => (
    segment.charAt(0).toUpperCase() + segment.slice(1)
  ));
}

function normalizeFileNamePart(value: string) {
  const trimmed = value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return toTitleCase(trimmed);
}

function parseFileName(fileName: string) {
  const baseName = stripFileExtension(fileName);
  const [rawTitle, ...rawAuthorParts] = baseName.split(/\s+-\s+/);
  const title = normalizeFileNamePart(rawTitle) || "Untitled";
  const author = normalizeFileNamePart(rawAuthorParts.join(" - ")) || "Unknown author";
  return { title, author };
}

async function detectBookFormat(file: File, t: TFunction<"shelf">): Promise<BookFormat> {
  const name = file.name.toLowerCase();
  const type = file.type;
  if (name.endsWith(".epub") || type === "application/epub+zip") return "epub";
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".mobi") || name.endsWith(".prc")) return "mobi";
  if (name.endsWith(".azw3") || name.endsWith(".azw") || name.endsWith(".kf8")) return "azw3";
  if (
    name.endsWith(".fb2") ||
    name.endsWith(".fb2.zip") ||
    name.endsWith(".fbz") ||
    type === "application/x-fictionbook+xml"
  ) {
    return "fb2";
  }

  // No usable extension or MIME type — Android SAF picks arrive as opaque
  // content:// names — so fall back to sniffing the file's magic bytes.
  const sniffed = await sniffBookFormat(file);
  if (sniffed) return sniffed;

  throw new Error(t("errors.unsupportedFormat", { name: file.name }));
}

function clampProgressPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getReadingStatus(progressPercent: number): ReadingStatus {
  if (progressPercent >= 100) return "finished";
  if (progressPercent > 0) return "reading";
  return "unread";
}

/**
 * The record as it lands on the shelf the instant a file is picked: title and
 * author parsed from the file name, no cover yet. The real metadata arrives
 * via `enrichImportedBook` — parsing a large book takes seconds of main-thread
 * time, so it never sits on the import path. `coverChecked: false` doubles as
 * the safety net: if enrichment never runs (app quit), the lazy cover repair
 * in `listLibraryBooks` still picks the record up.
 */
function createLibraryBook(file: File, format: BookFormat): LibraryBook {
  const now = new Date().toISOString();
  const parsed = parseFileName(file.name);

  return {
    id: crypto.randomUUID(),
    title: parsed.title,
    author: parsed.author,
    format,
    fileName: file.name,
    mimeType: file.type || "",
    fileSize: file.size,
    coverUrl: null,
    coverChecked: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    progressPercent: 0,
    readingStatus: "unread",
    progress: null,
    starred: false,
    collectionId: null,
  };
}

function sortBooks(books: LibraryBook[]) {
  return [...books].sort((left, right) => {
    const leftTime = new Date(left.lastOpenedAt ?? left.updatedAt).getTime();
    const rightTime = new Date(right.lastOpenedAt ?? right.updatedAt).getTime();
    return rightTime - leftTime;
  });
}

async function hydrateMissingBookCovers(books: LibraryBook[]) {
  // Re-extract covers for records that have no cover and were never checked:
  // legacy books imported before cover extraction, or imports whose extraction
  // failed transiently. `coverChecked` stops genuinely cover-less files from
  // being re-parsed on every load.
  const booksMissingCovers = books.filter(
    (book) => !book.coverUrl && !book.coverChecked,
  );
  if (booksMissingCovers.length === 0) return books;

  const repairedBooks = await Promise.all(booksMissingCovers.map(async (book) => {
    const blob = await getStoredBookBlob(book.id);
    // No stored file yet — leave the record untouched so a later import of the
    // file can still backfill the cover.
    if (!blob) return book;

    const file = new File([blob], book.fileName, { type: book.mimeType });
    const coverUrl = await extractBookCover(file);
    const nextBook: LibraryBook = {
      ...book,
      coverUrl: coverUrl ?? null,
      coverChecked: true,
    };

    await putBookRecord(nextBook);
    return nextBook;
  }));

  const repairedBookMap = new Map(repairedBooks.map((book) => [book.id, book]));
  return books.map((book) => repairedBookMap.get(book.id) ?? book);
}

// --- Public API --------------------------------------------------------------

export async function listLibraryBooks() {
  const books = await getAllBookRecords();
  return sortBooks(await hydrateMissingBookCovers(books));
}

/** Identity used to spot a re-import: same title + author + byte size. */
function bookDedupeKey(book: Pick<LibraryBook, "title" | "author" | "fileSize">): string {
  return `${book.title.trim().toLowerCase()}|${book.author.trim().toLowerCase()}|${book.fileSize}`;
}

export type ImportBookResult =
  | { status: "imported"; book: LibraryBook }
  | { status: "duplicate"; book: LibraryBook };

/**
 * The fast import path: sniff the format, store the bytes, put a record built
 * from the file name — no book parsing. The book is on the shelf (placeholder
 * cover) the moment this resolves; call `enrichImportedBook` afterwards to
 * fill in real metadata, the cover, and the renamed-re-import dedupe.
 */
export async function importBookFile(
  file: File,
  t: TFunction<"shelf">,
): Promise<ImportBookResult> {
  const existing = await getAllBookRecords();

  // Cheap pass: the identical file (same name + size) is already imported.
  const byFile = existing.find(
    (entry) => entry.fileName === file.name && entry.fileSize === file.size,
  );
  if (byFile) return { status: "duplicate", book: byFile };

  const format = await detectBookFormat(file, t);
  const book = createLibraryBook(file, format);
  await storeImportedBook(book, file);
  return { status: "imported", book };
}

export type EnrichBookResult =
  | { status: "enriched"; book: LibraryBook; foliateBook: unknown | null }
  | { status: "duplicate"; book: LibraryBook }
  | { status: "removed" };

/**
 * The slow half of an import, run off the critical path: one foliate parse
 * yields real title/author and the cover (the returned `foliateBook` lets the
 * caller feed the same parse into text extraction). The metadata dedupe that
 * used to gate the import happens here — a renamed re-import only becomes
 * recognizable once the real metadata is known — and rolls the new record
 * back. "removed" means the user deleted the book while it was being parsed.
 */
export async function enrichImportedBook(
  imported: LibraryBook,
  file: File,
): Promise<EnrichBookResult> {
  const { book: foliateBook, metadata } = await openBookWithMetadata(file);

  // Re-read after the (long) parse so lastOpenedAt/progress written meanwhile
  // survive the merge — and so a mid-parse delete stays deleted.
  const current = await getBookRecord(imported.id);
  if (!current) return { status: "removed" };

  const enriched: LibraryBook = {
    ...current,
    title: metadata.title?.trim() || current.title,
    author: metadata.author?.trim() || current.author,
    coverUrl: metadata.coverUrl ?? current.coverUrl ?? null,
    coverChecked: true,
    updatedAt: new Date().toISOString(),
  };

  const key = bookDedupeKey(enriched);
  const duplicateOf = (await getAllBookRecords()).find(
    (entry) => entry.id !== imported.id && bookDedupeKey(entry) === key,
  );
  if (duplicateOf) {
    await removeLibraryBook(imported.id);
    return { status: "duplicate", book: duplicateOf };
  }

  if (enriched.title !== current.title || enriched.author !== current.author) {
    emitDomainEvents({
      type: "book.metadataEdited",
      payload: {
        bookId: imported.id,
        ...(enriched.title !== current.title ? { title: enriched.title } : {}),
        ...(enriched.author !== current.author ? { author: enriched.author } : {}),
      },
    });
  }
  await putBookRecord(enriched);
  return { status: "enriched", book: enriched, foliateBook };
}

export async function getStoredBookBlob(bookId: string): Promise<Blob | null> {
  if (!isTauri()) return null;
  const bytes = await getDesktopBlob(bookFileKey(bookId));
  return bytes ? new Blob([bytes]) : null;
}

export async function updateLibraryBookProgress(bookId: string, progress: BookProgress) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const progressPercent = progress ? clampProgressPercent(progress.progressPercent) : existingBook.progressPercent;
  const now = new Date().toISOString();
  const nextBook: LibraryBook = {
    ...existingBook,
    progress,
    progressPercent,
    readingStatus: getReadingStatus(progressPercent),
    updatedAt: now,
    lastOpenedAt: now,
  };

  emitDomainEvents({
    type: "reading.progressed",
    payload: {
      bookId,
      locator: progress?.cfi ?? progress?.href ?? "",
      chapterHref: progress?.href ?? undefined,
      currentLocation: progress?.currentLocation,
      totalLocations: progress?.totalLocations,
      progressPercent,
      status: nextBook.readingStatus,
    },
  });
  await putBookRecord(nextBook);
  return nextBook;
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

  if (nextBook.title !== existingBook.title || nextBook.author !== existingBook.author) {
    emitDomainEvents({
      type: "book.metadataEdited",
      payload: {
        bookId,
        ...(nextBook.title !== existingBook.title ? { title: nextBook.title } : {}),
        ...(nextBook.author !== existingBook.author ? { author: nextBook.author } : {}),
      },
    });
  }
  await putBookRecord(nextBook);
  return nextBook;
}

export async function setLibraryBookStarred(bookId: string, starred: boolean) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  // Starring is metadata only — it must not bump recency (lastOpenedAt/updatedAt),
  // or pinning a book would also reshuffle the "recently opened" ordering.
  const nextBook: LibraryBook = { ...existingBook, starred };

  emitDomainEvents({ type: "book.starred", payload: { bookId, starred } });
  await putBookRecord(nextBook);
  return nextBook;
}

export async function listCollections() {
  const collections = await getAllCollectionRecords();
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCollection(name: string): Promise<Collection> {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled collection",
    createdAt: new Date().toISOString(),
  };
  emitDomainEvents({
    type: "collection.created",
    payload: { collectionId: collection.id, name: collection.name },
  });
  await putCollectionRecord(collection);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<Collection | null> {
  const existing = (await getAllCollectionRecords()).find((c) => c.id === id);
  if (!existing) return null;

  const next: Collection = { ...existing, name: name.trim() || existing.name };
  emitDomainEvents({
    type: "collection.renamed",
    payload: { collectionId: id, name: next.name },
  });
  await putCollectionRecord(next);
  return next;
}

/**
 * Delete a collection and clear its books' membership (the books stay).
 * `collection.removed` implies the membership clearing on replay — no per-book
 * `book.removedFromCollection` events are emitted for it.
 */
export async function deleteCollection(id: string) {
  assertDesktop("Deleting a collection");
  emitDomainEvents({ type: "collection.removed", payload: { collectionId: id } });
  await invoke("library_delete_collection", { id });
}

/** Assign a set of books to a collection (or null to ungroup them). */
export async function setBooksCollection(bookIds: string[], collectionId: string | null) {
  if (bookIds.length === 0) return;
  const idSet = new Set(bookIds);
  const all = await getAllBookRecords();
  const affected = all.filter((book) => idSet.has(book.id) && book.collectionId !== collectionId);
  emitDomainEvents(
    ...affected.map((book) =>
      collectionId
        ? {
            type: "book.addedToCollection" as const,
            payload: { bookId: book.id, collectionId },
          }
        : {
            type: "book.removedFromCollection" as const,
            // Ungrouping: the membership being removed is the book's current one.
            payload: { bookId: book.id, collectionId: book.collectionId as string },
          },
    ),
  );
  for (const book of affected) {
    await putBookRecord({ ...book, collectionId });
  }
}

export async function removeLibraryBooks(bookIds: string[]) {
  await deleteBookRecords(bookIds);
}

export async function markLibraryBookOpened(bookId: string) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const now = new Date().toISOString();
  const nextBook: LibraryBook = {
    ...existingBook,
    lastOpenedAt: now,
    updatedAt: now,
  };

  emitDomainEvents({ type: "book.opened", payload: { bookId } });
  await putBookRecord(nextBook);
  return nextBook;
}

export async function removeLibraryBook(bookId: string) {
  await deleteBookRecords([bookId]);
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
