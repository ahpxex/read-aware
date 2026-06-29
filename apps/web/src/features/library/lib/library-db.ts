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

const DB_NAME = "read-aware-library";
const DB_VERSION = 2;
const BOOKS_STORE = "books";
const FILES_STORE = "files";
const COLLECTIONS_STORE = "collections";

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

function detectBookFormat(file: File): BookFormat {
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

  throw new Error(
    `Unsupported file type: ${file.name}. Supported formats: EPUB, MOBI, AZW3, FB2, PDF.`,
  );
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

async function saveBookRecord(book: LibraryBook) {
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  transaction.objectStore(BOOKS_STORE).put(book);
  await waitForTransaction(transaction);
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

    await saveBookRecord(nextBook);
    return nextBook;
  }));

  const repairedBookMap = new Map(repairedBooks.map((book) => [book.id, book]));
  return books.map((book) => repairedBookMap.get(book.id) ?? book);
}

export async function listLibraryBooks() {
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readonly");
  const books = await requestToPromise(transaction.objectStore(BOOKS_STORE).getAll() as IDBRequest<LibraryBook[]>);
  await waitForTransaction(transaction);
  return sortBooks(await hydrateMissingBookCovers(books));
}

/** Identity used to spot a re-import: same title + author + byte size. */
function bookDedupeKey(book: Pick<LibraryBook, "title" | "author" | "fileSize">): string {
  return `${book.title.trim().toLowerCase()}|${book.author.trim().toLowerCase()}|${book.fileSize}`;
}

export type ImportBookResult =
  | { status: "imported"; book: LibraryBook }
  | { status: "duplicate"; book: LibraryBook };

export async function importBookFile(file: File): Promise<ImportBookResult> {
  const db = await openLibraryDb();
  const existing = await requestToPromise(
    db
      .transaction(BOOKS_STORE, "readonly")
      .objectStore(BOOKS_STORE)
      .getAll() as IDBRequest<LibraryBook[]>,
  );

  // Cheap pass: the identical file (same name + size) is already imported.
  const byFile = existing.find(
    (entry) => entry.fileName === file.name && entry.fileSize === file.size,
  );
  if (byFile) return { status: "duplicate", book: byFile };

  const format = detectBookFormat(file);
  const metadata = await extractBookMetadata(file);
  const book = createLibraryBook(file, format, metadata);

  // Metadata pass: same title + author + size catches a renamed re-import.
  const key = bookDedupeKey(book);
  const byMetadata = existing.find((entry) => bookDedupeKey(entry) === key);
  if (byMetadata) return { status: "duplicate", book: byMetadata };

  const transaction = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
  transaction.objectStore(BOOKS_STORE).put(book);
  transaction.objectStore(FILES_STORE).put({
    bookId: book.id,
    blob: file,
  } satisfies StoredBookFile);
  await waitForTransaction(transaction);
  return { status: "imported", book };
}

export async function getStoredBookBlob(bookId: string) {
  const db = await openLibraryDb();
  const transaction = db.transaction(FILES_STORE, "readonly");
  const storedFile = await requestToPromise(
    transaction.objectStore(FILES_STORE).get(bookId) as IDBRequest<StoredBookFile | undefined>,
  );
  await waitForTransaction(transaction);
  return storedFile?.blob ?? null;
}

async function getBookRecord(bookId: string) {
  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readonly");
  const book = await requestToPromise(
    transaction.objectStore(BOOKS_STORE).get(bookId) as IDBRequest<LibraryBook | undefined>,
  );
  await waitForTransaction(transaction);
  return book ?? null;
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

  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  transaction.objectStore(BOOKS_STORE).put(nextBook);
  await waitForTransaction(transaction);
  return nextBook;
}

export async function setLibraryBookStarred(bookId: string, starred: boolean) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  // Starring is metadata only — it must not bump recency (lastOpenedAt/updatedAt),
  // or pinning a book would also reshuffle the "recently opened" ordering.
  const nextBook: LibraryBook = { ...existingBook, starred };

  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  transaction.objectStore(BOOKS_STORE).put(nextBook);
  await waitForTransaction(transaction);
  return nextBook;
}

export async function listCollections() {
  const db = await openLibraryDb();
  const transaction = db.transaction(COLLECTIONS_STORE, "readonly");
  const collections = await requestToPromise(
    transaction.objectStore(COLLECTIONS_STORE).getAll() as IDBRequest<Collection[]>,
  );
  await waitForTransaction(transaction);
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCollection(name: string): Promise<Collection> {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled collection",
    createdAt: new Date().toISOString(),
  };
  const db = await openLibraryDb();
  const transaction = db.transaction(COLLECTIONS_STORE, "readwrite");
  transaction.objectStore(COLLECTIONS_STORE).put(collection);
  await waitForTransaction(transaction);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<Collection | null> {
  const db = await openLibraryDb();
  const existing = await requestToPromise(
    db.transaction(COLLECTIONS_STORE, "readonly").objectStore(COLLECTIONS_STORE).get(id) as IDBRequest<
      Collection | undefined
    >,
  );
  if (!existing) return null;

  const next: Collection = { ...existing, name: name.trim() || existing.name };
  const transaction = db.transaction(COLLECTIONS_STORE, "readwrite");
  transaction.objectStore(COLLECTIONS_STORE).put(next);
  await waitForTransaction(transaction);
  return next;
}

/** Delete a collection and clear its books' membership (the books stay). */
export async function deleteCollection(id: string) {
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
  const db = await openLibraryDb();
  const all = await requestToPromise(
    db.transaction(BOOKS_STORE, "readonly").objectStore(BOOKS_STORE).getAll() as IDBRequest<
      LibraryBook[]
    >,
  );

  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  const store = transaction.objectStore(BOOKS_STORE);
  for (const book of all) {
    if (idSet.has(book.id)) store.put({ ...book, collectionId });
  }
  await waitForTransaction(transaction);
}

export async function removeLibraryBooks(bookIds: string[]) {
  if (bookIds.length === 0) return;
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

export async function markLibraryBookOpened(bookId: string) {
  const existingBook = await getBookRecord(bookId);
  if (!existingBook) return null;

  const nextBook: LibraryBook = {
    ...existingBook,
    lastOpenedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const db = await openLibraryDb();
  const transaction = db.transaction(BOOKS_STORE, "readwrite");
  transaction.objectStore(BOOKS_STORE).put(nextBook);
  await waitForTransaction(transaction);
  return nextBook;
}

export async function removeLibraryBook(bookId: string) {
  const db = await openLibraryDb();
  const transaction = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
  transaction.objectStore(BOOKS_STORE).delete(bookId);
  transaction.objectStore(FILES_STORE).delete(bookId);
  await waitForTransaction(transaction);
}
