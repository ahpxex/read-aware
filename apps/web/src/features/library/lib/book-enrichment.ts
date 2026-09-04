import { invoke } from "../../../platform/ipc";
import { emitAppEvent } from "../../../platform/app-events";
import { commitDomainEvents } from "../../../platform/domain-events";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import {
  foliateAuthor,
  foliateTitle,
  makeFoliateBook,
  type FoliateBook,
} from "../../reader/lib/foliate-engine";
import { parseFileName } from "./book-file-name";
import { getBookRecord, openLocalBookFile } from "./library-db";
import type { BookFormat, LibraryBook } from "./library-types";

const log = createLogger("book-enrichment");

/**
 * The reading engine as a metadata source — the second line behind the
 * native import extractors.
 *
 * Native extraction settles most books at import (EPUB/MOBI/FB2/CBZ covers
 * and titles, PDF covers on macOS). What it cannot settle — PDF title/author
 * everywhere, PDF covers off macOS, RAR comics, and any container the
 * lightweight parser choked on — is queued here. The job parses the stored
 * file headlessly with foliate (the same parse the reader would do), stores
 * the cover through `library_put_cover` (bounded in Rust), and commits the
 * verdict as `book.coverExtracted` — so the answer syncs and no device asks
 * the question twice.
 *
 * Runs serially: one parse at a time keeps a multi-file import from stacking
 * parsers on the main thread. It never fetches from the relay: a book whose
 * bytes are not local is skipped (its cover, if any, reaches this device as
 * a synced blob through the cover hydrator instead).
 */

export type EnrichmentRequest = {
  bookId: string;
  /** Decide the cover (`coverStatus` is `unchecked`). */
  cover: boolean;
  /** Fill title/author from the parsed metadata. */
  metadata: boolean;
};

/** Formats foliate can parse without a view. Virtual books have no file. */
const ENGINE_FORMATS: ReadonlySet<BookFormat> = new Set([
  "epub",
  "mobi",
  "azw3",
  "fb2",
  "cbz",
  "cbr",
  "pdf",
]);

type StoredCover = { coverBlobKey: string; sha256: string } | null;

const queue: EnrichmentRequest[] = [];
const queued = new Map<string, EnrichmentRequest>();
/** Books this session already tried: a failed parse is not retried in a loop. */
const attempted = new Set<string>();
let draining = false;

/** Queue a book; a request already queued for the same id merges into it. */
export function scheduleBookEnrichment(request: EnrichmentRequest): void {
  if (!isTauri()) return;
  const pending = queued.get(request.bookId);
  if (pending) {
    pending.cover ||= request.cover;
    pending.metadata ||= request.metadata;
    return;
  }
  const entry = { ...request };
  queued.set(request.bookId, entry);
  queue.push(entry);
  void drain();
}

/**
 * A PDF whose title is still the one the file name gave it: the engine
 * metadata pass never ran to completion (the app quit mid-import, the parse
 * failed once). The file name is the only source that produces exactly that
 * string, so the comparison is precise, not a guess.
 */
function metadataStillFromFileName(book: LibraryBook): boolean {
  return book.format === "pdf" && book.title === parseFileName(book.fileName).title;
}

/**
 * Boot / reload pass: every shelf book with an open question whose file is
 * here gets a job — a missing cover verdict, or PDF metadata never filled.
 * Legacy rows (imported before verdicts were recorded) and interrupted
 * imports are caught up this way.
 */
export function scheduleCatchUpEnrichment(books: readonly LibraryBook[]): void {
  for (const book of books) {
    if (!ENGINE_FORMATS.has(book.format)) continue;
    if (attempted.has(book.id)) continue;
    const cover = book.coverStatus === "unchecked";
    const metadata = metadataStillFromFileName(book);
    if (cover || metadata) scheduleBookEnrichment({ bookId: book.id, cover, metadata });
  }
}

/**
 * The reader has a parsed book in hand: settle an open question with it
 * instead of parsing again. Cheap when there is nothing to do.
 */
export async function enrichFromOpenBook(book: LibraryBook, parsed: FoliateBook): Promise<void> {
  const cover = book.coverStatus === "unchecked";
  const metadata = metadataStillFromFileName(book);
  if (!cover && !metadata) return;
  if (!ENGINE_FORMATS.has(book.format)) return;
  queued.delete(book.id);
  attempted.add(book.id);
  try {
    await applyParsedBook({ bookId: book.id, cover, metadata }, parsed);
  } catch (error) {
    log.warn(`cover from the open book failed for ${book.id}`, error);
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const request = queue.shift()!;
      queued.delete(request.bookId);
      attempted.add(request.bookId);
      try {
        await runJob(request);
      } catch (error) {
        log.warn(`engine enrichment failed for ${request.bookId}`, error);
      }
    }
  } finally {
    draining = false;
  }
}

async function runJob(request: EnrichmentRequest): Promise<void> {
  const book = await getBookRecord(request.bookId);
  if (!book) return; // Removed while queued.
  const needsCover = request.cover && book.coverStatus === "unchecked";
  if (!needsCover && !request.metadata) return;
  if (!ENGINE_FORMATS.has(book.format)) return;
  const file = await openLocalBookFile(book);
  if (!file) {
    // Not on this device (a synced-in shell): nothing to parse. The cover,
    // if the importing device found one, arrives through the hydrator.
    return;
  }
  const parsed = await makeFoliateBook(file);
  try {
    await applyParsedBook({ ...request, cover: needsCover }, parsed);
  } finally {
    (parsed as { destroy?: () => void }).destroy?.();
  }
}

async function applyParsedBook(request: EnrichmentRequest, parsed: FoliateBook): Promise<void> {
  const current = await getBookRecord(request.bookId);
  if (!current) return;
  const events = [];

  if (request.metadata) {
    const title = foliateTitle(parsed);
    const author = foliateAuthor(parsed);
    const patch = {
      ...(title && title !== current.title ? { title } : {}),
      ...(author && author !== current.author ? { author } : {}),
    };
    if (Object.keys(patch).length > 0) {
      events.push({
        type: "book.metadataEdited" as const,
        payload: { bookId: request.bookId, ...patch },
        // Parsed-metadata enrichment is app machinery, not a user edit.
        origin: "system" as const,
      });
    }
  }

  if (request.cover && current.coverStatus === "unchecked") {
    const stored = await storeParsedCover(request.bookId, parsed);
    events.push(
      stored
        ? {
            type: "book.coverExtracted" as const,
            payload: {
              bookId: request.bookId,
              status: "ready" as const,
              coverBlobKey: stored.coverBlobKey,
            },
            origin: "system" as const,
          }
        : {
            type: "book.coverExtracted" as const,
            payload: { bookId: request.bookId, status: "none" as const },
            origin: "system" as const,
          },
    );
  }

  if (events.length === 0) return;
  await commitDomainEvents(...events);
  emitAppEvent("book-changed", { bookId: request.bookId });
}

async function storeParsedCover(bookId: string, parsed: FoliateBook): Promise<StoredCover> {
  let blob: Blob | null = null;
  try {
    blob = (await parsed.getCover?.()) ?? null;
  } catch (error) {
    log.warn(`engine could not extract a cover for ${bookId}`, error);
    return null;
  }
  if (!blob || blob.size === 0) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<StoredCover>("library_put_cover", bytes, {
    headers: {
      "x-book-id": bookId,
      ...(blob.type ? { "x-blob-mime": blob.type } : {}),
    },
  });
}
