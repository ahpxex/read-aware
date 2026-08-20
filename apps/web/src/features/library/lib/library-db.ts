import { invoke } from "@tauri-apps/api/core";
import type { EventOrigin } from "@read-aware/core";
import type { TFunction } from "i18next";
import {
  deleteDesktopBlob,
  desktopBlobManifestExists,
  getDesktopBlob,
  getDesktopBlobInfo,
  openDesktopBlobFile,
  putDesktopBlob,
  putDesktopBlobFromPath,
} from "../../../platform/blob-store";
import { commitDomainEvents } from "../../../platform/domain-events";
import { fetchRemoteBlob } from "../../../platform/sync/sync-scheduler";
import type {
  BookFormat,
  BookImportSource,
  BookProgress,
  Collection,
  LibraryBook,
  ReadingStatus,
} from "./library-types";
import { bytesToDataUrl, dataUrlToBytes } from "../../../platform/data-url";
import {
  extractImportedFileMetadata,
  extractOpenedBookMetadata,
} from "./library-cover";
import {
  extractNativeBookMetadata,
  type NativeBookMetadata,
} from "./native-book-metadata";
import { parseFileName } from "./book-file-name";
import { sniffBookFormat } from "./book-format-sniff";
import { isTauri } from "../../../platform/environment";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import type { BookFileSource } from "../../reader/lib/reader-types";
import { emitAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";

const log = createLogger("library");

/** Blob-store key for a book's original file bytes (desktop SQLite backend). */
const bookFileKey = (bookId: string) => `bookfile:${bookId}`;

/** Blob-store key for a book's extracted cover (synced — kind `cover_image`). */
const bookCoverKey = (bookId: string) => `cover:${bookId}`;

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

/**
 * Persist an extracted cover as its synced blob and return the coverExtracted
 * event to commit alongside whatever the caller is logging. The extraction
 * RESULT syncs (a small `cover:` blob + event) so other devices paint their
 * shelves without re-parsing the book — which they may not even hold yet.
 * Null when the cover isn't a decodable data URL; the caller then keeps it
 * on the local cache lane only.
 */
async function stageCoverExtracted(
  bookId: string,
  coverDataUrl: string,
): Promise<{ type: "book.coverExtracted"; payload: { bookId: string; status: "ready"; coverBlobKey: string } } | null> {
  const decoded = dataUrlToBytes(coverDataUrl);
  if (!decoded) return null;
  await putDesktopBlob(bookCoverKey(bookId), decoded.bytes, decoded.mimeType);
  return {
    type: "book.coverExtracted",
    payload: { bookId, status: "ready", coverBlobKey: bookCoverKey(bookId) },
  };
}

export type BookImportCommit =
  | { status: "imported" }
  /** The exact same file already lives on the shelf (possibly synced in). */
  | { status: "duplicate"; existingId: string };

async function storeImportedBook(
  book: LibraryBook,
  source: BookImportSource,
  origin?: EventOrigin,
): Promise<BookImportCommit> {
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
  // Content gate: the hash knows what the metadata dedupe can't — the same
  // file re-imported under a different title, or a copy that synced in from
  // another device (its manifest row carries the sha before any bytes do).
  const existingId = await invoke<string | null>("library_find_book_by_sha", {
    sha256,
    excludeId: book.id,
  });
  if (existingId) {
    // If the existing record is a synced-in shell without local bytes, the
    // bytes the user just handed us are exactly what it was missing.
    if (!(await getDesktopBlobInfo(bookFileKey(existingId)))) {
      const bytes = await getDesktopBlob(bookFileKey(book.id));
      if (bytes) await putDesktopBlob(bookFileKey(existingId), bytes, book.mimeType || undefined);
    }
    await deleteDesktopBlob(bookFileKey(book.id));
    return { status: "duplicate", existingId };
  }
  const coverEvent = book.coverUrl ? await stageCoverExtracted(book.id, book.coverUrl) : null;
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
  }, ...(coverEvent ? [{ ...coverEvent, origin }] : []));
  // The data-URL copy still rides the local cache lane for synchronous paint.
  if (book.coverUrl || book.coverChecked) {
    await putBookCover(book.id, book.coverUrl ?? null, Boolean(book.coverChecked));
  }
  return { status: "imported" };
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
  if (name.endsWith(".cbz") || type === "application/vnd.comicbook+zip") return "cbz";
  if (name.endsWith(".cbr") || type === "application/vnd.comicbook-rar") return "cbr";
  if (name.endsWith(".txt") || name.endsWith(".text") || type === "text/plain") return "txt";
  if (
    name.endsWith(".html") ||
    name.endsWith(".htm") ||
    name.endsWith(".xhtml") ||
    type === "text/html"
  ) {
    return "html";
  }

  // No usable extension or MIME type — some Android providers return
  // extension-less display names — so fall back to sniffing magic bytes.
  const sniffed = await sniffImportSource(source, info.name);
  if (sniffed) return sniffed;

  throw new Error(t("errors.unsupportedFormat", { name: info.name }));
}

/**
 * Head window for import-time format sniffing. Every magic number sits in the
 * first 4 KB; the MOBI/AZW3 discriminator (record 0) almost always within
 * 64 KB — and a record beyond the window falls back to "mobi".
 */
const SNIFF_HEAD_BYTES = 64 * 1024;

async function sniffImportSource(
  source: BookImportSource,
  name: string,
): Promise<BookFormat | null> {
  if (source.kind === "file") return sniffBookFormat(source.file);
  if (!isTauri()) return null;
  try {
    const head = await invoke<ArrayBuffer>("read_book_head", {
      path: source.path,
      length: SNIFF_HEAD_BYTES,
    });
    // A head-window File is all the sniffer ever reads from.
    return await sniffBookFormat(new File([head], name));
  } catch (error) {
    log.warn(`Unable to sniff the format of ${name}`, error);
    return null;
  }
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
 * The preparation phase. Native-path sources extract in Rust (EPUBs read only
 * their ZIP directory, OPF, and cover entry; macOS PDFs use PDFKit) so the
 * book never enters the webview. File sources (mobile picks, plugin
 * `importBook`) are already in-memory bytes, so the engine parses them
 * headlessly instead. The first reader open still fills anything the import
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
  // Native paths extract in Rust so the book never enters the webview; file
  // sources (mobile picks, plugin importBook) are already in-memory bytes,
  // so the engine parses them directly — either way the shelf entry lands
  // with its real title, author, and cover instead of waiting for first open.
  const metadata = source.kind === "native-path"
    ? await extractNativeBookMetadata(format, source.path)
    : await extractImportedFileMetadata(source.file, format);
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
): Promise<BookImportCommit> {
  return storeImportedBook(book, source, origin);
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

  // Two lanes, deliberately separate: title/author are domain facts; the
  // cover's data-URL copy is a local cache for synchronous paint — but the
  // extraction RESULT syncs as a `cover:` blob + coverExtracted event, so
  // other devices inherit the artwork instead of re-parsing the book.
  const events = [];
  if (enriched.title !== current.title || enriched.author !== current.author) {
    events.push({
      type: "book.metadataEdited" as const,
      payload: {
        bookId: imported.id,
        ...(enriched.title !== current.title ? { title: enriched.title } : {}),
        ...(enriched.author !== current.author ? { author: enriched.author } : {}),
      },
      // Parsed-metadata enrichment is app machinery, not a user edit.
      origin: "system" as const,
    });
  }
  if (metadata.coverUrl && metadata.coverUrl !== current.coverUrl) {
    const coverEvent = await stageCoverExtracted(imported.id, metadata.coverUrl);
    if (coverEvent) events.push({ ...coverEvent, origin: "system" as const });
  }
  if (events.length > 0) {
    await commitDomainEvents(...events);
  }
  if (enriched.coverUrl !== current.coverUrl || enriched.coverChecked !== current.coverChecked) {
    await putBookCover(imported.id, enriched.coverUrl ?? null, Boolean(enriched.coverChecked));
  }
  return { status: "enriched", book: (await getBookRecord(imported.id)) ?? enriched };
}

/**
 * Fill a synced-in book's cover cache from its `cover:` blob — the consumer
 * half of coverExtracted. The manifest row (left behind by replay) is the
 * gate: no row means no device ever extracted a cover, so nothing to fetch
 * and no network probe. Bytes come locally or lazily off the relay, land in
 * the same data-URL cache lane an import fills, and `coverChecked` flips so
 * this runs once per book. Null when there is nothing to do.
 */
export async function hydrateSyncedCover(book: LibraryBook): Promise<LibraryBook | null> {
  if (!isTauri() || book.coverUrl || book.coverChecked) return null;
  const key = bookCoverKey(book.id);
  if (!(await desktopBlobManifestExists(key))) return null;
  let bytes = await getDesktopBlob(key);
  if (!bytes && (await fetchRemoteBlob(key)).outcome === "fetched") {
    bytes = await getDesktopBlob(key);
  }
  if (!bytes) return null;
  const info = await getDesktopBlobInfo(key);
  const dataUrl = await bytesToDataUrl(bytes, info?.mimeType || "image/jpeg");
  await putBookCover(book.id, dataUrl, true);
  return { ...book, coverUrl: dataUrl, coverChecked: true };
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

/**
 * Reader source for an imported book, with the missing-file cause attached.
 * PDFs stay file-backed and random-access; the other parsers still receive a
 * whole-file blob until they expose the same structural range contract end to
 * end.
 *
 * The blob is always wrapped back into a named `File`: foliate's `makeBook`
 * picks the loader for ZIP containers from the file NAME (a `.cbz` comic and a
 * `.fbz` FictionBook are both zips), so a nameless blob would be read as an
 * EPUB — and, before that, crash on `name.endsWith`.
 */
export async function resolveStoredBookFile(
  bookOrId: Pick<LibraryBook, "id" | "format" | "fileName" | "mimeType"> | string,
): Promise<StoredBookFileResult> {
  if (!isTauri()) return { status: "missing", reason: "no-sync" };
  const book = typeof bookOrId === "string" ? await getBookRecord(bookOrId) : bookOrId;
  if (!book) return { status: "missing", reason: "no-sync" };
  const openLocal = async (): Promise<BookFileSource | null> => {
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
  };

  const local = await openLocal();
  if (local) return { status: "ok", file: local };
  const fetched = await fetchBookFile(book.id);
  if (!fetched.ok) return { status: "missing", reason: fetched.reason };
  const pulled = await openLocal();
  // A successful fetch that still opens nothing means the local write raced a
  // wipe — treat as unreachable so the user retries rather than re-imports.
  return pulled
    ? { status: "ok", file: pulled }
    : { status: "missing", reason: "unreachable" };
}

export async function getStoredBookFile(
  bookOrId: Pick<LibraryBook, "id" | "format" | "fileName" | "mimeType"> | string,
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
