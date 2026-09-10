import { AppError, errorCode, type BookContentState, type BookContentObservation } from "@read-aware/core";
import { getBookRecord } from "../features/library/lib/library-db";
import { getVirtualBookBinding, resolveContentProvider } from "../features/plugins/lib/virtual-books";
import { virtualSourceRevision } from "../features/library/lib/content-invalidation";
import { getDesktopBlobInfo } from "../platform/blob-store";
import { isTauri } from "../platform/environment";
import { afterLocalKVWrites } from "../platform/local-store";
import { createLogger } from "../platform/logger";

const log = createLogger("book-content-state");
function validate(bookId: string) {
  if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256) throw new AppError("ui/invalid-target", "Invalid book ID");
}

export async function getBookContentState(bookId: string, signal?: AbortSignal): Promise<BookContentState> {
  validate(bookId); signal?.throwIfAborted();
  if (!isTauri()) throw new AppError("ui/unavailable", "Content state requires the desktop app");
  const book = await getBookRecord(bookId);
  if (!book) throw new AppError("library/book-not-found", "Book is not in the library");
  if (book.format === "virtual") {
    return afterLocalKVWrites(() => {
      signal?.throwIfAborted();
      const binding = getVirtualBookBinding(bookId);
      const provider = binding ? resolveContentProvider(binding) : null;
      return { bookId, source: "virtual", availability: !binding ? "missing" : provider ? "provider-registered" : "provider-unavailable",
        sourceRevision: virtualSourceRevision(bookId, provider, binding?.key ?? ""), contentVersion: null };
    });
  }
  const info = await getDesktopBlobInfo(`bookfile:${bookId}`);
  signal?.throwIfAborted();
  const contentVersion = info?.sha256 ? `sha256:${info.sha256}` : null;
  return { bookId, source: "file", availability: info ? "local" : "missing",
    sourceRevision: contentVersion ?? (info ? "unversioned" : "missing"), contentVersion };
}

/** Serial, latest-state observation; it is not a complete content-change log. */
export function createContentStateObserver(lifetime?: AbortSignal, deps = {
  read: getBookContentState,
  report: (error: unknown) => log.warn("Content state observation failed", error),
  schedule: (work: () => void) => {
    const timer = setTimeout(work, 1000);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    return () => clearTimeout(timer);
  },
}) {
  let count = 0;
  return (bookId: string, handler: (event: BookContentObservation) => unknown): (() => void) => {
    validate(bookId);
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("ui/superseded", "Observer owner retired");
    if (count >= 64) throw new AppError("ui/unavailable", "Too many content observers");
    count++;
    let disposed = false, previous: string | undefined, cancelTimer: (() => void) | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true; count--; cancelTimer?.();
      lifetime?.removeEventListener("abort", dispose);
    };
    const poll = async () => {
      let event: BookContentObservation;
      try { event = { status: "ready", snapshot: await deps.read(bookId, lifetime) }; }
      catch (error) {
        if (disposed) return;
        deps.report(error); event = { status: "error", errorCode: errorCode(error) ?? "internal" };
      }
      if (disposed) return;
      const key = JSON.stringify(event);
      if (key !== previous) {
        try { await handler(structuredClone(event)); previous = key; }
        catch (error) { deps.report(error); }
      }
      if (!disposed) cancelTimer = deps.schedule(() => { cancelTimer = undefined; void poll(); });
    };
    lifetime?.addEventListener("abort", dispose, { once: true }); void poll();
    return dispose;
  };
}
