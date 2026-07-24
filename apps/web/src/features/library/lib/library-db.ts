import { invoke } from "@tauri-apps/api/core";
import type { EventOrigin } from "@read-aware/core";
import type { TFunction } from "i18next";
import {
  getDesktopBlob,
  openDesktopBlobFile,
  putDesktopBlob,
  putDesktopBlobFromPath,
} from "../../../platform/blob-store";
import { commitDomainEvents } from "../../../platform/domain-events";
import type {
  BookFormat,
  BookImportSource,
  BookProgress,
  Collection,
  LibraryBook,
  ReadingStatus,
} from "./library-types";
import { extractOpenedBookMetadata } from "./library-cover";
import {
  extractNativeEpubMetadata,
  extractNativePdfMetadata,
  type NativeBookMetadata,
} from "./native-book-metadata";
import { sniffBookFormat } from "./book-format-sniff";
import { isTauri } from "../../../platform/environment";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import type { BookFileSource } from "../../reader/lib/reader-types";
import { emitAppEvent } from "../../../platform/app-events";

/** Blob-store key for a book's original file bytes (desktop SQLite backend). */
const bookFileKey = (bookId: string) => `bookfile:${bookId}`;

// --- Storage primitives ------------------------------------------------------
// Desktop-only: native SQLite (Rust commands) + blob store. The browser build
// is a pure UI shell (Storybook feeds components fixture props) — reads come
// back empty so surfaces render their empty states, writes throw instead of
// pretending to persist. Everything below (dedup, cover hydration, sorting) is
// pure and backend-agnostic.
//
// WRITES GO THROUGH EVENTS. `commitDomainEvents` appends to the log and applies
// the projection in one SQLite transaction, then these functions read the row
// back — the store decides what was persisted, this module does not predict it.
// `putBookRecord` survives for the two paths that legitimately bypass the log:
// restoring a backup verbatim (genesis synthesizes its events at next boot) and
// the cover cache, which is object-storage-derived, not a domain fact.

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

/** Persist the cover cache. Not a domain fact — see the note above. */
async function putBookCover(
  bookId: string,
  coverUrl: string | null,
  coverChecked: boolean,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("library_set_book_cover", { id: bookId, coverUrl, coverChecked });
}

async function storeImportedBook(
  book: LibraryBook,
  source: BookImportSource,
  origin?: EventOrigin,
): Promise<void> {
  assertDesktop("Importing a book");
  const { sha256 } = source.kind === "native-path"
    ? await putDesktopBlobFromPath(
        bookFileKey(book.id),
        source.path,
        book.mimeType || undefined,
      )
    : await putDesktopBlob(
        bookFileKey(book.id),
        new Uint8Array(await source.file.arrayBuffer()),
        book.mimeType || undefined,
      );
  await commitDomainEvents({
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
    origin,
  });
  // The import extractor may already have found a cover; it rides the local
  // cache lane, not the log.
  if (book.coverUrl || book.coverChecked) {
    await putBookCover(book.id, book.coverUrl ?? null, Boolean(book.coverChecked));
  }
}

async function deleteBookRecords(bookIds: string[], origin?: EventOrigin): Promise<void> {
  if (bookIds.length === 0) return;
  assertDesktop("Removing books");
  // `book.removed` drops the row and its annotations on apply; the blob is
  // object-storage content and is released separately.
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

function sourceFileInfo(source: BookImportSource) {
  return source.kind === "native-path"
    ? { name: source.name, size: source.size, type: "" }
    : { name: source.file.name, size: source.file.size, type: source.file.type };
}

async function detectBookFormat(source: BookImportSource, t: TFunction<"shelf">): Promise<BookFormat> {
  const info = sourceFileInfo(source);
  const name = info.name.toLowerCase();
  const type = info.type;
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
  const sniffed = source.kind === "file" ? await sniffBookFormat(source.file) : null;
  if (sniffed) return sniffed;

  throw new Error(t("errors.unsupportedFormat", { name: info.name }));
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
 * Build the shelf record from lightweight native EPUB metadata when available,
 * otherwise from the file name. Missing fields are filled from the reader's
 * already-open foliate book later; import never starts the full parser itself.
 */
function createLibraryBook(
  source: BookImportSource,
  format: BookFormat,
  metadata: NativeBookMetadata | null = null,
): LibraryBook {
  const now = new Date().toISOString();
  const file = sourceFileInfo(source);
  const parsed = parseFileName(file.name);

  return {
    id: crypto.randomUUID(),
    title: metadata?.title?.trim() || parsed.title,
    author: metadata?.author?.trim() || parsed.author,
    format,
    fileName: file.name,
    mimeType: file.type || "",
    fileSize: file.size,
    coverUrl: metadata?.coverUrl ?? null,
    coverChecked: Boolean(metadata?.coverUrl),
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

// --- Public API --------------------------------------------------------------

/**
 * A plugin-provided (virtual) shelf entry: no blob, content resolved by the
 * plugin's content provider at open time. `coverChecked: true` keeps the
 * reader's lazy metadata enrichment away from it.
 */
export async function addVirtualLibraryBook(
  input: { title: string; author?: string },
  origin?: EventOrigin,
): Promise<LibraryBook> {
  assertDesktop("Adding a virtual book");
  const bookId = crypto.randomUUID();
  await commitDomainEvents({
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
  });
  // Nothing to extract from a virtual book — mark the cover resolved so the
  // reader's lazy enrichment leaves it alone.
  await putBookCover(bookId, null, true);
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

/** Identity used to spot a re-import: same title + author + byte size. */
function bookDedupeKey(book: Pick<LibraryBook, "title" | "author" | "fileSize">): string {
  return `${book.title.trim().toLowerCase()}|${book.author.trim().toLowerCase()}|${book.fileSize}`;
}

export type PrepareBookImportResult =
  | { status: "prepared"; book: LibraryBook }
  | { status: "duplicate"; book: LibraryBook };

/**
 * The preparation phase: desktop EPUBs read only their ZIP directory, OPF, and
 * cover entry in Rust; macOS PDFs use PDFKit for bounded metadata and cover
 * extraction. Other formats fall back to file-name metadata. No foliate parser
 * runs during import. The first reader open fills anything the lightweight
 * extractors could not find from its already-parsed foliate object.
 */
export async function prepareBookImport(
  source: BookImportSource,
  t: TFunction<"shelf">,
  existing: LibraryBook[],
): Promise<PrepareBookImportResult> {
  const file = sourceFileInfo(source);

  // Cheap pass: the identical file (same name + size) is already imported.
  const byFile = existing.find(
    (entry) => entry.fileName === file.name && entry.fileSize === file.size,
  );
  if (byFile) return { status: "duplicate", book: byFile };

  const format = await detectBookFormat(source, t);
  const metadata = source.kind === "native-path"
    ? format === "epub"
      ? await extractNativeEpubMetadata(source.path)
      : format === "pdf"
        ? await extractNativePdfMetadata(source.path)
        : null
    : null;
  const book = createLibraryBook(source, format, metadata);
  const byMetadata = existing.find((entry) => bookDedupeKey(entry) === bookDedupeKey(book));
  if (byMetadata) return { status: "duplicate", book: byMetadata };
  return { status: "prepared", book };
}

/** Make a prepared import durable without changing its shelf identity/order. */
export async function commitBookImport(
  book: LibraryBook,
  source: BookImportSource,
  origin?: EventOrigin,
): Promise<void> {
  await storeImportedBook(book, source, origin);
}

export type EnrichBookResult =
  | { status: "enriched"; book: LibraryBook }
  | { status: "duplicate"; book: LibraryBook }
  | { status: "removed" };

/** Enrich lazily from the reader's already-open foliate book, without parsing twice. */
export async function enrichOpenedBook(
  imported: LibraryBook,
  foliateBook: FoliateBook,
): Promise<EnrichBookResult> {
  return enrichParsedBook(imported, await extractOpenedBookMetadata(foliateBook));
}

async function enrichParsedBook(
  imported: LibraryBook,
  metadata: { title: string | null; author: string | null; coverUrl: string | null },
): Promise<EnrichBookResult> {

  // Re-read after the (long) parse so lastOpenedAt/progress written meanwhile
  // survive the merge — and so a mid-parse delete stays deleted.
  const current = await getBookRecord(imported.id);
  if (!current) return { status: "removed" };

  const enriched: LibraryBook = {
    ...current,
    title: metadata.title?.trim() || current.title,
    author: metadata.author?.trim() || current.author,
    coverUrl: metadata.coverUrl ?? current.coverUrl ?? null,
    // A PDF cover render is intentionally time-budgeted. If a complex or
    // blank leading page exceeds that budget, keep it eligible for a later
    // open: by then the reader may already have a meaningful page canvas that
    // the PDF adapter can reuse at effectively zero cost.
    coverChecked: imported.format === "pdf" && !metadata.coverUrl
      ? current.coverChecked
      : true,
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

  // Two lanes, deliberately separate: title/author are domain facts and go
  // through the log; the cover is extracted from the book file (object-storage
  // content) and goes straight to its local cache.
  if (enriched.title !== current.title || enriched.author !== current.author) {
    await commitDomainEvents({
      type: "book.metadataEdited",
      payload: {
        bookId: imported.id,
        ...(enriched.title !== current.title ? { title: enriched.title } : {}),
        ...(enriched.author !== current.author ? { author: enriched.author } : {}),
      },
      // Parsed-metadata enrichment is app machinery, not a user edit.
      origin: "system",
    });
  }
  if (enriched.coverUrl !== current.coverUrl || enriched.coverChecked !== current.coverChecked) {
    await putBookCover(imported.id, enriched.coverUrl ?? null, Boolean(enriched.coverChecked));
  }
  return { status: "enriched", book: (await getBookRecord(imported.id)) ?? enriched };
}

export async function getStoredBookBlob(bookId: string): Promise<Blob | null> {
  if (!isTauri()) return null;
  const bytes = await getDesktopBlob(bookFileKey(bookId));
  return bytes ? new Blob([bytes]) : null;
}

/**
 * Reader source for an imported book. PDFs stay file-backed and random-access;
 * the other parsers still receive an ordinary Blob until they expose the same
 * structural range contract end to end.
 */
export async function getStoredBookFile(
  bookOrId: Pick<LibraryBook, "id" | "format" | "fileName" | "mimeType"> | string,
): Promise<BookFileSource | null> {
  if (!isTauri()) return null;
  const book = typeof bookOrId === "string" ? await getBookRecord(bookOrId) : bookOrId;
  if (!book) return null;
  if (book.format === "pdf") {
    return openDesktopBlobFile(
      bookFileKey(book.id),
      book.fileName,
      book.mimeType || "application/pdf",
    );
  }
  return getStoredBookBlob(book.id);
}

export async function updateLibraryBookProgress(bookId: string, progress: BookProgress) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const progressPercent = progress ? clampProgressPercent(progress.progressPercent) : existingBook.progressPercent;
  await commitDomainEvents({
    type: "reading.progressed",
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
