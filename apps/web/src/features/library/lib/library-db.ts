import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import type {
  BookFormat,
  BookProgress,
  Collection,
  LibraryBook,
  ReadingStatus,
  StoredBookFile,
} from "./library-types";
import { extractBookCover, extractBookMetadata } from "./library-cover";
import type { ExtractedBookMetadata } from "./library-cover";
import { isTauri } from "../../../platform/environment";

const DB_NAME = "read-aware-library";
const DB_VERSION = 2;
const BOOKS_STORE = "books";
const FILES_STORE = "files";
const COLLECTIONS_STORE = "collections";

/** Blob-store key for a book's original file bytes (desktop SQLite backend). */
const bookFileKey = (bookId: string) => `bookfile:${bookId}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openLibraryDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "bookId" });
      }

      if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
        db.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Don't hold an old version open when another context (a reload after a
      // schema bump, or a second tab) needs to upgrade — close so it isn't blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open the local library database."));
  });

  return dbPromise;
}

// --- Storage primitives ------------------------------------------------------
// Each resolves by `isTauri()`: desktop → native SQLite (Rust commands + blob
// store); browser (vite dev / Storybook) → the existing IndexedDB code, kept
// byte-for-byte. Everything below (dedup, cover hydration, sorting) is pure and
// backend-agnostic.

async function getAllBookRecords(): Promise<LibraryBook[]> {
  if (isTauri()) return invoke<LibraryBook[]>("library_load");
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readonly");
  const books = await requestToPromise(
    transaction.objectStore(BOOKS_STORE).getAll() as IDBRequest<LibraryBook[]>,
  );
  await waitForTransaction(transaction);
  return books;
}

async function getBookRecord(bookId: string): Promise<LibraryBook | null> {
  if (isTauri()) {
    return (await invoke<LibraryBook | null>("library_get_book", { id: bookId })) ?? null;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readonly");
  const book = await requestToPromise(
    transaction.objectStore(BOOKS_STORE).get(bookId) as IDBRequest<LibraryBook | undefined>,
  );
  await waitForTransaction(transaction);
  return book ?? null;
}

async function putBookRecord(book: LibraryBook): Promise<void> {
  if (isTauri()) {
    await invoke("library_put_book", { book });
    return;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  transaction.objectStore(BOOKS_STORE).put(book);
  await waitForTransaction(transaction);
}

async function storeImportedBook(book: LibraryBook, file: File): Promise<void> {
  if (isTauri()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await invoke("put_blob", { key: bookFileKey(book.id), data: bytes });
    await invoke("library_put_book", { book });
    return;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
  transaction.objectStore(BOOKS_STORE).put(book);
  transaction.objectStore(FILES_STORE).put({ bookId: book.id, blob: file } satisfies StoredBookFile);
  await waitForTransaction(transaction);
}

async function deleteBookRecords(bookIds: string[]): Promise<void> {
  if (bookIds.length === 0) return;
  if (isTauri()) {
    await invoke("library_delete_books", { ids: bookIds });
    return;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
  const books = transaction.objectStore(BOOKS_STORE);
  const files = transaction.objectStore(FILES_STORE);
  for (const id of bookIds) {
    books.delete(id);
    files.delete(id);
  }
  await waitForTransaction(transaction);
}

async function getAllCollectionRecords(): Promise<Collection[]> {
  if (isTauri()) return invoke<Collection[]>("library_list_collections");
  const db = await openLibraryDb();
  const transaction = db.transaction(COLLECTIONS_STORE, "readonly");
  const collections = await requestToPromise(
    transaction.objectStore(COLLECTIONS_STORE).getAll() as IDBRequest<Collection[]>,
  );
  await waitForTransaction(transaction);
  return collections;
}

async function putCollectionRecord(collection: Collection): Promise<void> {
  if (isTauri()) {
    await invoke("library_put_collection", { collection });
    return;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction(COLLECTIONS_STORE, "readwrite");
  transaction.objectStore(COLLECTIONS_STORE).put(collection);
  await waitForTransaction(transaction);
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

function detectBookFormat(file: File, t: TFunction<"shelf">): BookFormat {
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

function createLibraryBook(
  file: File,
  format: BookFormat,
  metadata: ExtractedBookMetadata,
): LibraryBook {
  const now = new Date().toISOString();
  const parsed = parseFileName(file.name);

  return {
    id: crypto.randomUUID(),
    title: metadata.title?.trim() || parsed.title,
    author: metadata.author?.trim() || parsed.author,
    format,
    fileName: file.name,
    mimeType: file.type || "",
    fileSize: file.size,
    coverUrl: metadata.coverUrl,
    coverChecked: true,
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

  const format = detectBookFormat(file, t);
  const metadata = await extractBookMetadata(file);
  const book = createLibraryBook(file, format, metadata);

  // Metadata pass: same title + author + size catches a renamed re-import.
  const key = bookDedupeKey(book);
  const byMetadata = existing.find((entry) => bookDedupeKey(entry) === key);
  if (byMetadata) return { status: "duplicate", book: byMetadata };

  await storeImportedBook(book, file);
  return { status: "imported", book };
}

export async function getStoredBookBlob(bookId: string): Promise<Blob | null> {
  if (isTauri()) {
    const bytes = await invoke<number[] | null>("get_blob", { key: bookFileKey(bookId) });
    return bytes ? new Blob([new Uint8Array(bytes)]) : null;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction(FILES_STORE, "readonly");
  const storedFile = await requestToPromise(
    transaction.objectStore(FILES_STORE).get(bookId) as IDBRequest<StoredBookFile | undefined>,
  );
  await waitForTransaction(transaction);
  return storedFile?.blob ?? null;
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

  await putBookRecord(nextBook);
  return nextBook;
}

export async function setLibraryBookStarred(bookId: string, starred: boolean) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  // Starring is metadata only — it must not bump recency (lastOpenedAt/updatedAt),
  // or pinning a book would also reshuffle the "recently opened" ordering.
  const nextBook: LibraryBook = { ...existingBook, starred };

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
  await putCollectionRecord(collection);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<Collection | null> {
  const existing = (await getAllCollectionRecords()).find((c) => c.id === id);
  if (!existing) return null;

  const next: Collection = { ...existing, name: name.trim() || existing.name };
  await putCollectionRecord(next);
  return next;
}

/** Delete a collection and clear its books' membership (the books stay). */
export async function deleteCollection(id: string) {
  if (isTauri()) {
    await invoke("library_delete_collection", { id });
    return;
  }
  const db = await openLibraryDb();
  const all = await requestToPromise(
    db.transaction(BOOKS_STORE, "readonly").objectStore(BOOKS_STORE).getAll() as IDBRequest<
      LibraryBook[]
    >,
  );

  const transaction = db.transaction([BOOKS_STORE, COLLECTIONS_STORE], "readwrite");
  const books = transaction.objectStore(BOOKS_STORE);
  for (const book of all) {
    if (book.collectionId === id) books.put({ ...book, collectionId: null });
  }
  transaction.objectStore(COLLECTIONS_STORE).delete(id);
  await waitForTransaction(transaction);
}

/** Assign a set of books to a collection (or null to ungroup them). */
export async function setBooksCollection(bookIds: string[], collectionId: string | null) {
  if (bookIds.length === 0) return;
  const idSet = new Set(bookIds);
  const all = await getAllBookRecords();
  const affected = all.filter((book) => idSet.has(book.id) && book.collectionId !== collectionId);
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

  await putBookRecord(nextBook);
  return nextBook;
}

export async function removeLibraryBook(bookId: string) {
  await deleteBookRecords([bookId]);
}

// --- Restore (import a previously-exported bundle; ids preserved) ------------

async function putBookFileBytes(bookId: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) {
    await invoke("put_blob", { key: bookFileKey(bookId), data: bytes });
    return;
  }
  const db = await openLibraryDb();
  const transaction = db.transaction(FILES_STORE, "readwrite");
  transaction
    .objectStore(FILES_STORE)
    .put({ bookId, blob: new Blob([bytes]) } satisfies StoredBookFile);
  await waitForTransaction(transaction);
}

/** Upsert a book record verbatim (id preserved) and, if given, its file bytes. */
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
