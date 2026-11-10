/** Native adapter for the shared, versioned derived-text repository. */
import { AppError, type BookTextSnapshot } from "@read-aware/core";
import { createTextTaskHistory } from "./book-text-history-storage";
import { readingRuntime } from "../../../domain/reading-runtime";
import { emitAppEvent, onAppEvent } from "../../../platform/app-events";
import { actorFromEvent, type DomainActor } from "../../../platform/domain-actor";
import { deleteDesktopBlob, getDesktopBlob, getDesktopBlobInfo, putDesktopBlob } from "../../../platform/blob-store";
import { localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { chapterMapFor, type FoliateBook } from "../../reader/lib/foliate-engine";
import { provideStoredNavigation, withBookContent } from "./book-content-source";
import { getBookRecord, getStoredBookFile } from "./library-db";
import { parseStoredNavigation } from "./book-text-record";
import { BookTextRepository } from "./book-text-repository";
import { getVirtualTextSource, forgetVirtualTextSource } from "./virtual-text-source";
import { BookTextTaskOwner } from "./book-text-tasks";
import { getRemoteBlobFetchConditions } from "../../../platform/sync/sync-scheduler";
export type { ExtractedChapter, NavigationItem } from "./book-text-record";

const log = createLogger("book-text");
const blobKey = (bookId: string) => `booktext:${bookId}`;
/**
 * The navigation copy kept beside a book's text (see `StoredNavigation`):
 * device-local, in the store that is already in memory, so reading it costs
 * an opening nothing. It is derived from the text record and never roams.
 */
const navigationKey = (bookId: string) => `read-aware-book-navigation:${bookId}`;
/**
 * A navigation larger than this stays in the record alone. The local store
 * is held in memory whole; a book with tens of thousands of entries reads
 * its record at opening as before rather than living there.
 */
const KEPT_NAVIGATION_MAX_CHARS = 256 * 1024;

// MessageChannel avoids background WebKit timer throttling between sections.
const yieldToUi = (() => {
  const channel = new MessageChannel();
  const waiters: (() => void)[] = [];
  channel.port1.onmessage = () => waiters.shift()?.();
  return () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      channel.port2.postMessage(null);
    });
})();

const repository = new BookTextRepository({
  retrievalConditions: getRemoteBlobFetchConditions,
  source: async (bookId, fetchMissing) => {
    const book = await getBookRecord(bookId);
    if (!book) throw new AppError("library/book-not-found", "Book is not in the library");
    if (book.format === "virtual") return getVirtualTextSource(bookId, fetchMissing);
    let info = await getDesktopBlobInfo(`bookfile:${bookId}`);
    if (!info?.sha256 && fetchMissing) {
      if (!(await getStoredBookFile(book)))
        throw new AppError("library/content-unavailable", "Book source is missing locally and could not be retrieved");
      info = await getDesktopBlobInfo(`bookfile:${bookId}`);
    }
    return { format: book.format, contentVersion: info?.sha256 ? `sha256:${info.sha256}` : null };
  },
  read: async (bookId) => {
    const bytes = await getDesktopBlob(blobKey(bookId));
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
      log.warn("Discarding malformed derived book text", error);
      return null;
    }
  },
  write: async (record) => {
    await putDesktopBlob(blobKey(record.bookId), new TextEncoder().encode(JSON.stringify(record)), "application/json");
  },
  remove: (bookId) => deleteDesktopBlob(blobKey(bookId)),
  navigation: {
    kept: (bookId) => {
      const raw = localKV.getItem(navigationKey(bookId));
      return raw ? parseStoredNavigation(JSON.parse(raw)) : null;
    },
    keep: (bookId, navigation) => {
      const key = navigationKey(bookId);
      const value = navigation ? JSON.stringify(navigation) : null;
      const write =
        value && value.length <= KEPT_NAVIGATION_MAX_CHARS
          ? localKV.getItem(key) === value
            ? null
            : localKV.setItemAsync(key, value, "system")
          : localKV.getItem(key) === null
            ? null
            : localKV.removeItemAsync(key, "system");
      // The local store rolls a failed write back and reports it; the copy is
      // then simply absent and the next opening reads the record.
      write?.catch((error: unknown) => log.warn("Keeping book navigation failed", error));
    },
  },
  content: (bookId, version, signal, read) =>
    withBookContent(bookId, version, signal, async ({ book }) => read(book, await chapterMapFor(book))),
  yieldToReader: async (signal, waiting) => {
    while (readingRuntime.readerDemandDelay > 0) {
      signal.throwIfAborted();
      waiting?.(true);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, readingRuntime.readerDemandDelay);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    signal.throwIfAborted();
    waiting?.(false);
    await yieldToUi();
    signal.throwIfAborted();
  },
  warn: (message, error) => log.warn(message, error),
  changed: (bookId, actor) => emitAppEvent("book-text-changed", { bookId }, actor),
});

onAppEvent("book-removed", (event) => {
  const { bookId } = event;
  forgetVirtualTextSource(bookId);
  void repository
    .remove(bookId, actorFromEvent(event))
    .catch((error) => log.warn("Removed book text cleanup failed", error));
});

export const getBookTextSnapshot = (bookId: string): Promise<BookTextSnapshot> => repository.snapshot(bookId);
export const createBookTextTaskOwner = (
  lifetime?: AbortSignal,
  origin: import("../../../platform/domain-actor").DomainActor = "user",
  trackCleanup?: (work: Promise<void>) => void,
) =>
  new BookTextTaskOwner(
    repository,
    (message, error) => log.warn(message, error),
    lifetime,
    createTextTaskHistory(origin, trackCleanup),
  );
export const getDigestChapterSource = (
  bookId: string,
  index: number,
  version: string,
  signal?: AbortSignal,
  origin?: DomainActor,
) => repository.chapter(bookId, index, version, signal, origin);
export const getPersistedBookText = (bookId: string) => repository.persisted(bookId);
export const getPersistedBookNavigation = (bookId: string) => repository.persistedNavigation(bookId);
// Every preparation of a book restores the navigation stored with its text.
provideStoredNavigation(getPersistedBookNavigation);
// Borrow the active parser with its registered version, never attach a new hash to an old parser.
export const ensureBookTextExtracted = (bookId: string, preopened?: FoliateBook, origin?: DomainActor) =>
  repository.ensure(bookId, !!preopened, origin);
export async function getBookTextStatus(bookId: string): Promise<"ok" | "unextracted" | "textless"> {
  const state = await repository.snapshot(bookId);
  return state.status === "ready" ? (state.text === "textless" ? "textless" : "ok") : "unextracted";
}
export async function deleteBookText(bookIds: string[]): Promise<void> {
  for (const bookId of bookIds) await repository.remove(bookId);
}
