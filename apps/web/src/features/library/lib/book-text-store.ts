/** Native adapter for the shared, versioned derived-text repository. */
import { AppError, type BookTextSnapshot } from "@read-aware/core";
import { onAppEvent } from "../../../platform/app-events";
import { deleteDesktopBlob, getDesktopBlob, getDesktopBlobInfo, putDesktopBlob } from "../../../platform/blob-store";
import { createLogger } from "../../../platform/logger";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { withBookContent } from "./book-content-source";
import { getBookRecord, getStoredBookFile } from "./library-db";
import { BookTextRepository } from "./book-text-repository";
import { BookTextTaskOwner } from "./book-text-tasks";
export type { ExtractedChapter } from "./book-text-record";

const log = createLogger("book-text");
const blobKey = (bookId: string) => `booktext:${bookId}`;
let lastReaderDemandAt = 0;
onAppEvent("reader-demand-activity", () => { lastReaderDemandAt = Date.now(); });

// MessageChannel avoids background WebKit timer throttling between sections.
const yieldToUi = (() => {
  const channel = new MessageChannel();
  const waiters: (() => void)[] = [];
  channel.port1.onmessage = () => waiters.shift()?.();
  return () => new Promise<void>(resolve => { waiters.push(resolve); channel.port2.postMessage(null); });
})();

const repository = new BookTextRepository({
  source: async (bookId, fetchMissing) => {
    const book = await getBookRecord(bookId);
    if (!book) throw new AppError("library/book-not-found", "Book is not in the library");
    if (book.format === "virtual") return { format: book.format, contentVersion: null };
    let info = await getDesktopBlobInfo(`bookfile:${bookId}`);
    if (!info?.sha256 && fetchMissing) {
      if (!await getStoredBookFile(book)) throw new AppError("library/content-unavailable", "Book source is missing locally and could not be retrieved");
      info = await getDesktopBlobInfo(`bookfile:${bookId}`);
    }
    return { format: book.format, contentVersion: info?.sha256 ? `sha256:${info.sha256}` : null };
  },
  read: async bookId => {
    const bytes = await getDesktopBlob(blobKey(bookId));
    if (!bytes) return null;
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch (error) { log.warn("Discarding malformed derived book text", error); return null; }
  },
  write: async record => { await putDesktopBlob(blobKey(record.bookId), new TextEncoder().encode(JSON.stringify(record)), "application/json"); },
  remove: bookId => deleteDesktopBlob(blobKey(bookId)),
  content: (bookId, version, signal, read) => withBookContent(bookId, version, signal, ({ book }) => read(book)),
  yieldToReader: async signal => {
    while (Date.now() - lastReaderDemandAt < 1500) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1500 - (Date.now() - lastReaderDemandAt));
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    signal.throwIfAborted(); await yieldToUi(); signal.throwIfAborted();
  },
  warn: (message, error) => log.warn(message, error),
});

onAppEvent("book-removed", ({ bookId }) => {
  void repository.remove(bookId).catch(error => log.warn("Removed book text cleanup failed", error));
});

export const getBookTextSnapshot = (bookId: string): Promise<BookTextSnapshot> => repository.snapshot(bookId);
export const createBookTextTaskOwner = (lifetime?: AbortSignal) => new BookTextTaskOwner(repository, (message, error) => log.warn(message, error), lifetime);
export const getPersistedBookText = (bookId: string) => repository.persisted(bookId);
// Borrow the active parser with its registered version, never attach a new hash to an old parser.
export const ensureBookTextExtracted = (bookId: string, preopened?: FoliateBook) => repository.ensure(bookId, !!preopened);
export async function getBookTextStatus(bookId: string): Promise<"ok" | "unextracted" | "textless"> {
  const state = await repository.snapshot(bookId);
  return state.status === "ready" ? state.text === "textless" ? "textless" : "ok" : "unextracted";
}
export async function deleteBookText(bookIds: string[]): Promise<void> {
  for (const bookId of bookIds) await repository.remove(bookId);
}
