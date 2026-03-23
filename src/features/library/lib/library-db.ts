import type {
  BookProgress,
  LibraryBook,
  ReadingStatus,
  StoredBookFile,
} from "./library-types";
import { extractBookCover } from "./library-cover";

const DB_NAME = "read-aware-library";
const DB_VERSION = 1;
const BOOKS_STORE = "books";
const FILES_STORE = "files";

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
    };

    request.onsuccess = () => resolve(request.result);
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

function detectBookFormat(file: File): "epub" {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".epub") || file.type === "application/epub+zip") {
    return "epub";
  }

  throw new Error(`Unsupported file type: ${file.name}. Only EPUB files are supported.`);
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

function createLibraryBook(file: File, coverUrl: string | null): LibraryBook {
  const now = new Date().toISOString();
  const { title, author } = parseFileName(file.name);

  return {
    id: crypto.randomUUID(),
    title,
    author,
    format: "epub",
    fileName: file.name,
    mimeType: file.type || "application/epub+zip",
    fileSize: file.size,
    coverUrl,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    progressPercent: 0,
    readingStatus: "unread",
    progress: null,
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
  const booksMissingCovers = books.filter((book) => book.coverUrl === undefined);
  if (booksMissingCovers.length === 0) return books;

  const repairedBooks = await Promise.all(booksMissingCovers.map(async (book) => {
    const file = await getStoredBookBlob(book.id);
    const coverUrl = file ? await extractBookCover(file) : null;
    const nextBook: LibraryBook = {
      ...book,
      coverUrl,
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

export async function importBookFile(file: File) {
  detectBookFormat(file);
  const coverUrl = await extractBookCover(file);
  const book = createLibraryBook(file, coverUrl);
  const db = await openLibraryDb();
  const transaction = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
  transaction.objectStore(BOOKS_STORE).put(book);
  transaction.objectStore(FILES_STORE).put({
    bookId: book.id,
    blob: file,
  } satisfies StoredBookFile);
  await waitForTransaction(transaction);
  return book;
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
