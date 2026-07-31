/**
 * Shelf domain — the whole of library management as ONE capability surface:
 * books (imports, metadata, stars, removal, content reads), collections (the
 * shelf's user-defined groups; single-membership today, the event vocabulary
 * already carries set semantics), and stats (positions, statuses, and active
 * reading time — read-only by design: its events are recorded facts of
 * reader activity, not user-intent commands).
 *
 * Reads return the canonical read models (@read-aware/core read-models.ts);
 * commands issue the domain's event verbs through the app's dual-write seams,
 * attributed to the constructing actor's origin; `on` subscribes to the
 * domain's canonical events (SHELF_EVENTS).
 */
import type {
  BookStats,
  BookSummary,
  ChapterRef,
  CollectionSummary,
  EventOrigin,
  StatsOverview,
} from "@read-aware/core";
import { i18n } from "../i18n";
import { emitAppEvent } from "../platform/app-events";
import {
  addVirtualLibraryBook,
  commitBookImport,
  createCollection,
  deleteCollection,
  listCollections,
  listLibraryBooks,
  prepareBookImport,
  removeLibraryBook,
  removeLibraryBooks,
  renameCollection,
  setBooksCollection,
  setLibraryBookFinished,
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
import {
  loadReadingStatsStore,
  type BookReadingStats,
} from "../features/reader/lib/reading-stats";
import { SHELF_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

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

/** Position/status/time of one book, joined from its row and the time store. */
function toBookStats(book: LibraryBook, time: BookReadingStats | undefined): BookStats {
  return {
    bookId: book.id,
    progressPercent: book.progressPercent ?? 0,
    status: book.readingStatus,
    locator: book.progress?.cfi ?? book.progress?.href ?? undefined,
    chapterHref: book.progress?.href ?? undefined,
    currentLocation: book.progress?.currentLocation,
    totalLocations: book.progress?.totalLocations,
    totalMs: time?.totalMs ?? 0,
    firstReadAt:
      time?.firstStartedAt != null ? new Date(time.firstStartedAt).toISOString() : undefined,
    lastReadAt:
      time?.lastReadAt != null ? new Date(time.lastReadAt).toISOString() : undefined,
    daily: { ...(time?.daily ?? {}) },
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

export type ShelfBooks = {
  list(): Promise<BookSummary[]>;
  get(bookId: string): Promise<BookSummary | null>;
  getToc(bookId: string): Promise<ChapterRef[]>;
  getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
  /** Import a real file; the result is a first-class book. */
  importBook(input: { fileName: string; data: ArrayBuffer | Uint8Array }): Promise<BookSummary>;
  editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
  setStarred(bookId: string, starred: boolean): Promise<void>;
  /** The reader's own "I finished this" verdict; sticky against further reading. */
  setFinished(bookId: string, finished: boolean): Promise<void>;
  /** Remove a book from the shelf — irreversible for the source file. */
  remove(bookId: string): Promise<void>;
  /** Batch removal (one storage round-trip; one event per book). */
  removeMany(bookIds: string[]): Promise<void>;
  /**
   * Shelf entry for provider-served content (no file). Binding a virtual
   * book to its provider is the plugin runtime's concern, not the domain's.
   */
  addVirtualBook(input: { title: string; author?: string }): Promise<BookSummary>;
  updateVirtualBookTitle(bookId: string, title: string, author?: string): Promise<void>;
};

export type ShelfCollections = {
  list(): Promise<CollectionSummary[]>;
  /** Ids of the books currently in a collection. */
  booksIn(collectionId: string): Promise<string[]>;
  create(name: string): Promise<CollectionSummary>;
  rename(collectionId: string, name: string): Promise<void>;
  /** Delete the collection; its books stay, ungrouped. */
  remove(collectionId: string): Promise<void>;
  /** Assign books to a collection, or `null` to ungroup them. */
  assignBooks(bookIds: string[], collectionId: string | null): Promise<void>;
};

export type ShelfStats = {
  forBook(bookId: string): Promise<BookStats | null>;
  list(): Promise<BookStats[]>;
  /** Whole-shelf aggregate: total time, per-day time, status counts. */
  overview(): Promise<StatsOverview>;
};

export type ShelfDomain = {
  books: ShelfBooks;
  collections: ShelfCollections;
  stats: ShelfStats;
  on: DomainEventSubscribe<(typeof SHELF_EVENTS)[number]>;
};

export function createShelfDomain(origin: EventOrigin): ShelfDomain {
  const books: ShelfBooks = {
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
    setFinished: async (bookId, finished) => {
      await setLibraryBookFinished(String(bookId), finished === true, origin);
      notifyLibraryChanged();
    },
    remove: async (bookId) => {
      await removeLibraryBook(String(bookId), origin);
      notifyLibraryChanged();
    },
    removeMany: async (bookIds) => {
      await removeLibraryBooks(bookIds.map(String), origin);
      notifyLibraryChanged();
    },
    addVirtualBook: async (input) => {
      const book = await addVirtualLibraryBook(
        { title: String(input.title), author: input.author },
        origin,
      );
      notifyLibraryChanged();
      return toBookSummary(book);
    },
    updateVirtualBookTitle: async (bookId, title, author) => {
      await updateVirtualLibraryBookTitle(String(bookId), String(title), author, origin);
      notifyLibraryChanged();
    },
  };

  const collections: ShelfCollections = {
    list: async () =>
      (await listCollections()).map((collection) => ({
        id: collection.id,
        name: collection.name,
        createdAt: collection.createdAt,
      })),
    booksIn: async (collectionId) =>
      (await listLibraryBooks())
        .filter((book) => book.collectionId === String(collectionId))
        .map((book) => book.id),
    create: async (name) => {
      const collection = await createCollection(String(name), origin);
      notifyLibraryChanged();
      return { id: collection.id, name: collection.name, createdAt: collection.createdAt };
    },
    rename: async (collectionId, name) => {
      await renameCollection(String(collectionId), String(name), origin);
      notifyLibraryChanged();
    },
    remove: async (collectionId) => {
      await deleteCollection(String(collectionId), origin);
      notifyLibraryChanged();
    },
    assignBooks: async (bookIds, collectionId) => {
      await setBooksCollection(
        bookIds.map(String),
        collectionId == null ? null : String(collectionId),
        origin,
      );
      notifyLibraryChanged();
    },
  };

  const stats: ShelfStats = {
    forBook: async (bookId) => {
      const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
      if (!book) return null;
      const store = await loadReadingStatsStore();
      return toBookStats(book, store[book.id]);
    },
    list: async () => {
      const [allBooks, store] = await Promise.all([
        listLibraryBooks(),
        loadReadingStatsStore(),
      ]);
      return allBooks.map((book) => toBookStats(book, store[book.id]));
    },
    overview: async () => {
      const [allBooks, store] = await Promise.all([
        listLibraryBooks(),
        loadReadingStatsStore(),
      ]);
      const daily: Record<string, number> = {};
      let totalMs = 0;
      let first: number | null = null;
      let last: number | null = null;
      for (const entry of Object.values(store)) {
        totalMs += entry.totalMs;
        for (const [day, ms] of Object.entries(entry.daily)) {
          daily[day] = (daily[day] ?? 0) + ms;
        }
        if (entry.firstStartedAt != null && (first == null || entry.firstStartedAt < first)) {
          first = entry.firstStartedAt;
        }
        if (entry.lastReadAt != null && (last == null || entry.lastReadAt > last)) {
          last = entry.lastReadAt;
        }
      }
      return {
        totalMs,
        daily,
        firstReadAt: first != null ? new Date(first).toISOString() : undefined,
        lastReadAt: last != null ? new Date(last).toISOString() : undefined,
        booksReading: allBooks.filter((book) => book.readingStatus === "reading").length,
        booksFinished: allBooks.filter((book) => book.readingStatus === "finished").length,
      };
    },
  };

  return { books, collections, stats, on: domainSubscribe(SHELF_EVENTS, origin) };
}
