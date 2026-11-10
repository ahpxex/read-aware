import { actorOrigin, type DomainActor } from "../platform/domain-actor";
import type { DomainActorOwners } from "./actor-owners";
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
  BookNavigationToc,
  BookLocationSearch,
  BookLocationSearchPage,
  BookTextSnapshot,
  BookTextPrepareOptions,
  BookTextTaskSnapshot,
  BookTextSearch,
  BookTextHit,
  BookRemovalReceipt,
  BookRemovalCleanupQuery,
  BookRemovalCleanupPage,
  BookFileReleaseReceipt,
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
  retryLibraryBookFileRelease,
  listLibraryRemovalCleanup,
  renameCollection,
  setBooksCollection,
  setLibraryBookStarred,
  updateBookMetadata,
  updateVirtualLibraryBookTitle,
} from "../features/library/lib/library-db";
import { importBook } from "../features/library/lib/book-import";
import { getBookEnrichment, retryBookEnrichment, createEnrichmentObserver } from "./book-enrichment";
import { getBookContentState, createContentStateObserver } from "./book-content-state";
import { listDuplicateBooks, previewBookMerge, mergeDuplicateBooks, resolveMergedBook } from "./book-merge";
import { listBookFormats } from "./book-inspection";
import { searchBookText } from "../features/library/lib/book-text-search";
import { getBookNavigationToc, searchBookLocations } from "../features/library/lib/book-content-navigation";
import { listBookNavigationTargets } from "../features/library/lib/book-navigation-targets";
import { readBookRange } from "../features/library/lib/book-range";
import { listBookReferences, readBookReference } from "../features/library/lib/book-references";
import { listBookImages } from "../features/library/lib/book-images";
import type { LibraryBook } from "../features/library/lib/library-types";
import { observeLibraryInvalidation } from "./projection-invalidation";
import {
  ensureBookTextExtracted,
  getPersistedBookText,
  getBookTextSnapshot,
  createBookTextTaskOwner,
  type ExtractedChapter,
} from "../features/library/lib/book-text-store";
import { LIBRARY_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

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
    sourcePath: book.sourcePath ?? undefined,
    narrativity: book.narrativity ?? undefined,
    spoilerSensitive: book.spoilerSensitive ?? undefined,
  };
}

const notifyLibraryChanged = (actor: DomainActor): void => emitAppEvent("library-changed", {}, actor);

export async function getExtractedChapters(bookId: string, origin?: DomainActor): Promise<ExtractedChapter[]> {
  return ensureBookTextExtracted(bookId, undefined, origin);
}

export async function getPersistedChapters(bookId: string): Promise<ExtractedChapter[] | null> {
  return getPersistedBookText(bookId);
}

export type LibraryQueries = {
  books: {
    list(): Promise<BookSummary[]>;
    listFormats(): Promise<import("@read-aware/core").BookFormatCapability[]>;
    listDuplicates(
      query?: import("@read-aware/core").DuplicateBookQuery,
      signal?: AbortSignal,
    ): Promise<import("@read-aware/core").DuplicateBookPage>;
    previewMerge(bookId: string, signal?: AbortSignal): Promise<import("@read-aware/core").BookMergePreview | null>;
    resolveId(bookId: string, signal?: AbortSignal): Promise<string | null>;
    listRemovalCleanup(query?: BookRemovalCleanupQuery): Promise<BookRemovalCleanupPage>;
    get(bookId: string): Promise<BookSummary | null>;
    getToc(bookId: string): Promise<ChapterRef[]>;
    getTextState(bookId: string): Promise<BookTextSnapshot>;
    getEnrichment(bookId: string, signal?: AbortSignal): Promise<import("@read-aware/core").BookEnrichmentSnapshot>;
    getContentState(bookId: string, signal?: AbortSignal): Promise<import("@read-aware/core").BookContentState>;
    listTextTaskHistory(
      bookId: string,
      query?: import("@read-aware/core").BookTextTaskHistoryQuery,
    ): Promise<import("@read-aware/core").BookTextTaskHistoryPage>;
    getTextTask(bookId: string, taskId: string): Promise<BookTextTaskSnapshot>;
    listTextTasks(bookId: string): Promise<BookTextTaskSnapshot[]>;
    getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
    getNavigationToc(bookId: string, signal?: AbortSignal): Promise<BookNavigationToc>;
    listNavigationTargets(
      input: import("@read-aware/core").BookNavigationTargetsQuery,
      signal?: AbortSignal,
    ): Promise<import("@read-aware/core").BookNavigationTargetsPage>;
    searchLocations(input: BookLocationSearch, signal?: AbortSignal): Promise<BookLocationSearchPage>;
    readRange(
      input: import("@read-aware/core").BookRangeQuery,
      signal?: AbortSignal,
      allowedHrefs?: readonly string[],
    ): Promise<import("@read-aware/core").BookRangePage>;
    listReferences(
      input: import("@read-aware/core").BookReferencesQuery,
      signal?: AbortSignal,
      allowedHrefs?: readonly string[],
    ): Promise<import("@read-aware/core").BookReferencesPage>;
    listImages(
      input: import("@read-aware/core").BookImagesQuery,
      signal?: AbortSignal,
      allowedHrefs?: readonly string[],
    ): Promise<import("@read-aware/core").BookImagesPage>;
    readReference(
      input: import("@read-aware/core").BookReferenceQuery,
      signal?: AbortSignal,
      allowedHrefs?: readonly string[],
    ): Promise<import("@read-aware/core").BookReferencePreview>;
    searchText(input: BookTextSearch, signal?: AbortSignal): Promise<BookTextHit[]>;
  };
  collections: {
    list(): Promise<CollectionSummary[]>;
    booksIn(collectionId: string): Promise<string[]>;
  };
};

export type LibraryCommands = {
  books: {
    prepareText(
      bookId: string,
      options?: BookTextPrepareOptions,
      access?: import("../services/resource-access").ResourceAccess,
    ): Promise<BookTextTaskSnapshot>;
    retryEnrichment(bookId: string, signal?: AbortSignal): Promise<import("@read-aware/core").BookEnrichmentReceipt>;
    mergeDuplicates(
      input: import("@read-aware/core").BookMergeRequest,
      signal?: AbortSignal,
    ): Promise<import("@read-aware/core").BookMergeReceipt>;
    setTextTaskPriority(
      bookId: string,
      taskId: string,
      priority: import("@read-aware/core").BookTextPriority,
    ): Promise<BookTextTaskSnapshot>;
    pauseTextTask(bookId: string, taskId: string): Promise<BookTextTaskSnapshot>;
    resumeTextTask(bookId: string, taskId: string): Promise<BookTextTaskSnapshot>;
    cancelTextTask(bookId: string, taskId: string): Promise<BookTextTaskSnapshot>;
    importBook(
      input: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
      },
      signal?: AbortSignal,
    ): Promise<BookSummary>;
    editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
    setStarred(bookId: string, starred: boolean): Promise<void>;
    remove(bookId: string): Promise<void>;
    removeMany(bookIds: string[]): Promise<BookRemovalReceipt>;
    retryRemovalCleanup(bookIds: string[]): Promise<BookFileReleaseReceipt>;
    addVirtualBook(input: {
      title: string;
      author?: string;
      binding: import("../features/plugins/lib/virtual-books").VirtualBookBinding;
    }): Promise<BookSummary>;
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
    observeInvalidation(handler: (event: import("@read-aware/core").ProjectionInvalidation) => unknown): () => void;
    subscribe: DomainEventSubscribe<(typeof LIBRARY_EVENTS)[number]>;
    observeTextTask(bookId: string, taskId: string, listener: (snapshot: BookTextTaskSnapshot) => unknown): () => void;
    observeEnrichment(
      bookId: string,
      listener: (event: import("@read-aware/core").BookEnrichmentObservation) => unknown,
    ): () => void;
    observeContentState(
      bookId: string,
      listener: (event: import("@read-aware/core").BookContentObservation) => unknown,
    ): () => void;
  };
};

const agentTextTasks = createBookTextTaskOwner(undefined, "agent");
/** Host composition only; uses the same Agent task owner as actual preparation. */
export const agentTextPreparationConditions = (bookId: string, options: BookTextPrepareOptions, signal?: AbortSignal) =>
  agentTextTasks.conditions(bookId, options, signal);

export function createLibraryDomain(
  origin: DomainActor,
  lifetime?: AbortSignal,
  trackCleanup?: (work: Promise<void>) => void,
  owners: DomainActorOwners = {},
): LibraryDomain {
  const textTasks = (owners.textTasks ??=
    actorOrigin(origin) === "agent" ? agentTextTasks : createBookTextTaskOwner(lifetime, origin, trackCleanup));
  const queries: LibraryQueries = {
    books: {
      getNavigationToc: getBookNavigationToc,
      listNavigationTargets: listBookNavigationTargets,
      listFormats: listBookFormats,
      listDuplicates: (query, signal) => listDuplicateBooks(query, signal ?? lifetime),
      previewMerge: (bookId, signal) => previewBookMerge(bookId, signal ?? lifetime),
      resolveId: (bookId, signal) => resolveMergedBook(bookId, signal ?? lifetime),
      listRemovalCleanup: listLibraryRemovalCleanup,
      getTextState: getBookTextSnapshot,
      getEnrichment: (bookId, signal) => getBookEnrichment(bookId, signal ?? lifetime),
      getContentState: (bookId, signal) => getBookContentState(bookId, signal ?? lifetime),
      listTextTaskHistory: (bookId, query) => textTasks.listHistory(bookId, query),
      getTextTask: async (bookId, taskId) => textTasks.get(bookId, taskId),
      listTextTasks: async (bookId) => textTasks.list(bookId),
      searchLocations: searchBookLocations,
      readRange: readBookRange,
      listReferences: listBookReferences,
      listImages: listBookImages,
      readReference: readBookReference,
      searchText: (input, signal) =>
        searchBookText(
          {
            list: listLibraryBooks,
            extract: (bookId) => getExtractedChapters(bookId, origin),
            persisted: getPersistedChapters,
          },
          input,
          signal ?? lifetime,
        ),
      list: async () => (await listLibraryBooks()).map(toBookSummary),
      get: async (bookId) => {
        const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
        return book ? toBookSummary(book) : null;
      },
      getToc: async (bookId) =>
        (await getExtractedChapters(bookId, origin)).map<ChapterRef>((chapter, index) => ({
          index,
          title: chapter.title,
          chars: chapter.text.length,
        })),
      getChapterText: async (bookId, chapterIndex) =>
        (await getExtractedChapters(bookId, origin))[Number(chapterIndex)]?.text ?? null,
    },
    collections: {
      list: async () =>
        (await listCollections()).map((collection) => ({
          id: collection.id,
          name: collection.name,
          createdAt: collection.createdAt,
        })),
      booksIn: async (collectionId) =>
        (await listLibraryBooks()).filter((book) => book.collectionId === String(collectionId)).map((book) => book.id),
    },
  };

  const commands: LibraryCommands = {
    books: {
      prepareText: (bookId, options, access) => textTasks.start(bookId, options, origin, access),
      mergeDuplicates: (input, signal) => mergeDuplicateBooks(input, origin, signal ?? lifetime),
      retryEnrichment: (bookId, signal) => retryBookEnrichment(bookId, origin, signal ?? lifetime),
      setTextTaskPriority: async (bookId, taskId, priority) => textTasks.setPriority(bookId, taskId, priority, origin),
      pauseTextTask: async (bookId, taskId) => textTasks.pause(bookId, taskId, origin),
      resumeTextTask: async (bookId, taskId) => textTasks.resume(bookId, taskId, origin),
      cancelTextTask: async (bookId, taskId) => textTasks.cancel(bookId, taskId, origin),
      importBook: async (input, signal) => {
        const inputSignal = signal && lifetime ? AbortSignal.any([signal, lifetime]) : (signal ?? lifetime);
        inputSignal?.throwIfAborted();
        const file = new File([input.data], String(input.fileName));
        const outcome = await importBook(
          { kind: "file", file },
          { t: i18n.getFixedT(null, "shelf"), knownBooks: await listLibraryBooks(), origin, signal: inputSignal },
        );
        if (outcome.status === "imported") notifyLibraryChanged(origin);
        return toBookSummary(outcome.book);
      },
      editMetadata: async (bookId, patch) => {
        await updateBookMetadata(String(bookId), { title: patch.title, author: patch.author }, origin);
        notifyLibraryChanged(origin);
      },
      setStarred: async (bookId, starred) => {
        await setLibraryBookStarred(String(bookId), starred === true, origin);
        notifyLibraryChanged(origin);
      },
      remove: async (bookId) => {
        await removeLibraryBook(String(bookId), origin);
        notifyLibraryChanged(origin);
      },
      removeMany: async (bookIds) => {
        const receipt = await removeLibraryBooks(bookIds, origin);
        notifyLibraryChanged(origin);
        return receipt;
      },
      retryRemovalCleanup: retryLibraryBookFileRelease,
      addVirtualBook: async (input) => {
        const book = await addVirtualLibraryBook(
          { title: String(input.title), author: input.author, binding: input.binding },
          origin,
          lifetime,
        );
        notifyLibraryChanged(origin);
        return toBookSummary(book);
      },
      updateVirtualBookTitle: async (bookId, title, author) => {
        await updateVirtualLibraryBookTitle(String(bookId), String(title), author, origin);
        notifyLibraryChanged(origin);
      },
    },
    collections: {
      create: async (name) => {
        const collection = await createCollection(String(name), origin);
        notifyLibraryChanged(origin);
        return { id: collection.id, name: collection.name, createdAt: collection.createdAt };
      },
      rename: async (collectionId, name) => {
        await renameCollection(String(collectionId), String(name), origin);
        notifyLibraryChanged(origin);
      },
      remove: async (collectionId) => {
        await deleteCollection(String(collectionId), origin);
        notifyLibraryChanged(origin);
      },
      assignBooks: async (bookIds, collectionId) => {
        await setBooksCollection(bookIds.map(String), collectionId == null ? null : String(collectionId), origin);
        notifyLibraryChanged(origin);
      },
    },
  };

  return {
    queries,
    commands,
    events: {
      observeInvalidation: (handler) => observeLibraryInvalidation(handler, lifetime, origin),
      subscribe: domainSubscribe(LIBRARY_EVENTS, actorOrigin(origin)),
      observeTextTask: (bookId, taskId, listener) => textTasks.observe(bookId, taskId, listener, origin),
      observeEnrichment: createEnrichmentObserver(lifetime, origin),
      observeContentState: createContentStateObserver(lifetime, undefined, origin),
    },
  };
}
