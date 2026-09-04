/**
 * Library domain - books, source content, metadata, and collections.
 *
 * The public shape is deliberately uniform with every other domain:
 * `queries` inspect projections, `commands` commit state changes, and
 * `events.subscribe` observes committed domain events.
 */
import type {
  BookSummary,
  ChapterRef,
  CollectionSummary,
  EventOrigin,
} from "@read-aware/core";
import { i18n } from "../i18n";
import { emitAppEvent } from "../platform/app-events";
import {
  addVirtualLibraryBook,
  createCollection,
  deleteCollection,
  listCollections,
  listLibraryBooks,
  removeLibraryBook,
  removeLibraryBooks,
  renameCollection,
  setBooksCollection,
  setLibraryBookStarred,
  updateBookMetadata,
  updateVirtualLibraryBookTitle,
} from "../features/library/lib/library-db";
import { importBook } from "../features/library/lib/book-import";
import type { LibraryBook } from "../features/library/lib/library-types";
import {
  ensureBookTextExtracted,
  getPersistedBookText,
  type ExtractedChapter,
} from "../features/library/lib/book-text-store";
import {
  LIBRARY_EVENTS,
  domainSubscribe,
  type DomainEventSubscribe,
} from "./events";

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
    narrativity: book.narrativity ?? undefined,
  };
}

const notifyLibraryChanged = (): void => emitAppEvent("library-changed", {});

const chapterCache = new Map<string, ExtractedChapter[]>();

export async function getExtractedChapters(bookId: string): Promise<ExtractedChapter[]> {
  const key = String(bookId);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const chapters = await ensureBookTextExtracted(key);
  if (chapters.length > 0) chapterCache.set(key, chapters);
  return chapters;
}

export async function getPersistedChapters(bookId: string): Promise<ExtractedChapter[] | null> {
  const key = String(bookId);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const chapters = await getPersistedBookText(key);
  if (chapters) chapterCache.set(key, chapters);
  return chapters;
}

export type LibraryQueries = {
  books: {
    list(): Promise<BookSummary[]>;
    get(bookId: string): Promise<BookSummary | null>;
    getToc(bookId: string): Promise<ChapterRef[]>;
    getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
  };
  collections: {
    list(): Promise<CollectionSummary[]>;
    booksIn(collectionId: string): Promise<string[]>;
  };
};

export type LibraryCommands = {
  books: {
    importBook(input: {
      fileName: string;
      data: ArrayBuffer | Uint8Array;
    }): Promise<BookSummary>;
    editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
    setStarred(bookId: string, starred: boolean): Promise<void>;
    remove(bookId: string): Promise<void>;
    removeMany(bookIds: string[]): Promise<void>;
    addVirtualBook(input: { title: string; author?: string }): Promise<BookSummary>;
    updateVirtualBookTitle(bookId: string, title: string, author?: string): Promise<void>;
  };
  collections: {
    create(name: string): Promise<CollectionSummary>;
    rename(collectionId: string, name: string): Promise<void>;
    remove(collectionId: string): Promise<void>;
    assignBooks(bookIds: string[], collectionId: string | null): Promise<void>;
  };
};

export type LibraryDomain = {
  queries: LibraryQueries;
  commands: LibraryCommands;
  events: {
    subscribe: DomainEventSubscribe<(typeof LIBRARY_EVENTS)[number]>;
  };
};

export function createLibraryDomain(origin: EventOrigin): LibraryDomain {
  const queries: LibraryQueries = {
    books: {
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
    },
    collections: {
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
    },
  };

  const commands: LibraryCommands = {
    books: {
      importBook: async (input) => {
        const file = new File([input.data], String(input.fileName));
        const outcome = await importBook(
          { kind: "file", file },
          { t: i18n.getFixedT(null, "shelf"), knownBooks: await listLibraryBooks(), origin },
        );
        if (outcome.status === "imported") notifyLibraryChanged();
        return toBookSummary(outcome.book);
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
    },
    collections: {
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
    },
  };

  return {
    queries,
    commands,
    events: { subscribe: domainSubscribe(LIBRARY_EVENTS, origin) },
  };
}
