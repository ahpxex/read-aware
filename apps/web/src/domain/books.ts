/**
 * Books domain — the shared capability layer over the book projections and
 * the content-extraction store. Reads return the canonical read models
 * (@read-aware/core read-models.ts); commands issue the domain's event verbs
 * through the app's dual-write seams, attributed to the constructing actor's
 * origin; `on` subscribes to the domain's canonical events.
 */
import type { BookSummary, ChapterRef, EventOrigin } from "@read-aware/core";
import { i18n } from "../i18n";
import { emitAppEvent } from "../platform/app-events";
import {
  addVirtualLibraryBook,
  commitBookImport,
  listLibraryBooks,
  prepareBookImport,
  removeLibraryBook,
  setLibraryBookStarred,
  updateBookMetadata,
  updateVirtualLibraryBookTitle,
} from "../features/library/lib/library-db";
import type { LibraryBook } from "../features/library/lib/library-types";
import {
  ensureBookTextExtracted,
  getPersistedBookText,
  type ExtractedChapter,
} from "../features/library/lib/book-text-store";
import { BOOK_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

export function toBookSummary(book: LibraryBook): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author || undefined,
    format: book.format,
    starred: book.starred === true,
    collectionId: book.collectionId ?? null,
    addedAt: book.createdAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: book.lastOpenedAt ?? undefined,
    fileName: book.fileName || undefined,
    fileSize: book.fileSize || undefined,
  };
}

/** Shelf and library surfaces reload on this app event. */
const notifyLibraryChanged = (): void => emitAppEvent("library-changed", {});

// ─── Content extraction (shared session cache — domain reads + agent search) ─

const chapterCache = new Map<string, ExtractedChapter[]>();

/** Chapters of a book's extracted text; extraction runs on demand. */
export async function getExtractedChapters(bookId: string): Promise<ExtractedChapter[]> {
  const key = String(bookId);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const chapters = await ensureBookTextExtracted(key);
  if (chapters.length > 0) chapterCache.set(key, chapters);
  return chapters;
}

/** Already-persisted chapters only — never triggers extraction (bulk paths). */
export async function getPersistedChapters(bookId: string): Promise<ExtractedChapter[] | null> {
  const key = String(bookId);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const chapters = await getPersistedBookText(key);
  if (chapters) chapterCache.set(key, chapters);
  return chapters;
}

// ─── The domain API ──────────────────────────────────────────────────────────

export type BooksDomain = {
  list(): Promise<BookSummary[]>;
  get(bookId: string): Promise<BookSummary | null>;
  getToc(bookId: string): Promise<ChapterRef[]>;
  getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
  on: DomainEventSubscribe<(typeof BOOK_EVENTS)[number]>;
  /** Import a real file; the result is a first-class book. */
  importBook(input: { fileName: string; data: ArrayBuffer | Uint8Array }): Promise<BookSummary>;
  editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
  setStarred(bookId: string, starred: boolean): Promise<void>;
  /** Remove a book from the shelf — irreversible for the source file. */
  remove(bookId: string): Promise<void>;
  /**
   * Shelf entry for provider-served content (no file). Binding a virtual
   * book to its provider is the plugin runtime's concern, not the domain's.
   */
  addVirtualBook(input: { title: string; author?: string }): Promise<BookSummary>;
  updateVirtualBookTitle(bookId: string, title: string, author?: string): Promise<void>;
};

export function createBooksDomain(origin: EventOrigin): BooksDomain {
  return {
    list: async () => (await listLibraryBooks()).map(toBookSummary),
    get: async (bookId) => {
      const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
      return book ? toBookSummary(book) : null;
    },
    getToc: async (bookId) =>
      (await getExtractedChapters(bookId)).map<ChapterRef>((chapter, index) => ({
        index,
        title: chapter.title,
        chars: chapter.text.length,
      })),
    getChapterText: async (bookId, chapterIndex) =>
      (await getExtractedChapters(bookId))[Number(chapterIndex)]?.text ?? null,
    on: domainSubscribe(BOOK_EVENTS, origin),
    importBook: async (input) => {
      const file = new File([input.data], String(input.fileName));
      const t = i18n.getFixedT(null, "shelf");
      const existing = await listLibraryBooks();
      const result = await prepareBookImport({ kind: "file", file }, t, existing);
      if (result.status === "prepared") {
        await commitBookImport(result.book, { kind: "file", file }, origin);
        notifyLibraryChanged();
      }
      return toBookSummary(result.book);
    },
    editMetadata: async (bookId, patch) => {
      await updateBookMetadata(
        String(bookId),
        { title: patch.title, author: patch.author },
        origin,
      );
      notifyLibraryChanged();
    },
    setStarred: async (bookId, starred) => {
      await setLibraryBookStarred(String(bookId), starred === true, origin);
      notifyLibraryChanged();
    },
    remove: async (bookId) => {
      await removeLibraryBook(String(bookId), origin);
      notifyLibraryChanged();
    },
    addVirtualBook: async (input) => {
      const book = await addVirtualLibraryBook({
        title: String(input.title),
        author: input.author,
      });
      notifyLibraryChanged();
      return toBookSummary(book);
    },
    updateVirtualBookTitle: async (bookId, title, author) => {
      await updateVirtualLibraryBookTitle(String(bookId), String(title), author);
      notifyLibraryChanged();
    },
  };
}
