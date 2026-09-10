import { AppError, errorCode, type BookEnrichmentSnapshot, type BookEnrichmentReceipt,
  type BookEnrichmentObservation, type EventOrigin } from "@read-aware/core";
import { getBookRecord, hasLocalBookFile } from "../features/library/lib/library-db";
import { enrichmentQueue, ENRICHMENT_FORMATS, metadataNeedsEnrichment } from "../features/library/lib/book-enrichment";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";

const log = createLogger("enrichment-control");
function validate(id: string) {
  if (typeof id !== "string" || !id.trim() || id.length > 256) throw new AppError("ui/invalid-target", "Invalid book ID");
  if (!isTauri()) throw new AppError("ui/unavailable", "Enrichment requires the desktop app");
}

export async function getBookEnrichment(bookId: string, signal?: AbortSignal): Promise<BookEnrichmentSnapshot> {
  validate(bookId); signal?.throwIfAborted();
  const book = await getBookRecord(bookId);
  if (!book) throw new AppError("reader/book-not-found", "Book not found");
  const sourceLocal = await hasLocalBookFile(bookId);
  signal?.throwIfAborted();
  return { bookId, cover: { status: book.coverStatus, local: book.coverStatus === "ready" && book.coverLocal },
    metadataPending: metadataNeedsEnrichment(book), supported: ENRICHMENT_FORMATS.has(book.format), sourceLocal,
    job: enrichmentQueue.snapshot(bookId) };
}

export async function retryBookEnrichment(bookId: string, origin: EventOrigin, signal?: AbortSignal): Promise<BookEnrichmentReceipt> {
  const snapshot = await getBookEnrichment(bookId, signal);
  signal?.throwIfAborted();
  if (["queued", "running"].includes(snapshot.job.phase)) return { status: "already-running", snapshot };
  if (!snapshot.supported || !snapshot.sourceLocal) return { status: "unavailable", snapshot };
  const cover = snapshot.cover.status === "unchecked", metadata = snapshot.metadataPending;
  if (!cover && !metadata) return { status: "not-needed", snapshot };
  const entry = enrichmentQueue.enqueue({ bookId, cover, metadata, origin });
  return { status: "queued", snapshot: { ...snapshot, job: { ...entry.job } } };
}

/** Poll persisted cover/local-file state as well as this process's shared task state. */
export function createEnrichmentObserver(lifetime?: AbortSignal) {
  let count = 0;
  return (bookId: string, handler: (event: BookEnrichmentObservation) => unknown): (() => void) => {
    validate(bookId);
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("ui/superseded", "Observer owner retired");
    if (count >= 64) throw new AppError("ui/unavailable", "Too many enrichment observers");
    count++;
    let disposed = false, previous: string | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
      if (disposed) return; disposed = true; count--; clearTimeout(timer);
      lifetime?.removeEventListener("abort", dispose);
    };
    const poll = async () => {
      let event: BookEnrichmentObservation;
      try { event = { status: "ready", snapshot: await getBookEnrichment(bookId, lifetime) }; }
      catch (error) { event = { status: "error", errorCode: errorCode(error) ?? "internal" }; if (!disposed) log.warn("Enrichment observation failed", error); }
      if (disposed) return;
      const key = JSON.stringify(event);
      if (key !== previous) {
        try { await handler(structuredClone(event)); previous = key; }
        catch (error) { log.warn("Enrichment observer callback failed", error); }
      }
      if (!disposed) {
        timer = setTimeout(() => { void poll(); }, 1000);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      }
    };
    lifetime?.addEventListener("abort", dispose, { once: true }); void poll();
    return dispose;
  };
}
