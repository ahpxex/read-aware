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
import { EnrichmentQueue, type EnrichmentRequest, type EnrichmentOutcome } from "./enrichment-queue";
export type { EnrichmentRequest } from "./enrichment-queue";

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

/** Formats foliate can parse without a view. Virtual books have no file. */
export const ENRICHMENT_FORMATS: ReadonlySet<BookFormat> = new Set([
  "epub",
  "mobi",
  "azw3",
  "fb2",
  "cbz",
  "cbr",
  "pdf",
]);

type StoredCover = { coverBlobKey: string; sha256: string } | null;

export const enrichmentQueue = new EnrichmentQueue(runJob, error => log.warn("Engine enrichment failed", error));
/** Books this session already tried: a failed parse is not retried in a loop. */
const attempted = new Set<string>();

/** Queue a book; a request already queued for the same id merges into it. */
export function scheduleBookEnrichment(request: EnrichmentRequest): void {
  if (!isTauri()) return;
  try { enrichmentQueue.enqueue(request); }
  catch (error) { log.warn("Unable to schedule enrichment", error); }
}

/**
 * A PDF whose title is still the one the file name gave it: the engine
 * metadata pass never ran to completion (the app quit mid-import, the parse
 * failed once). Matching the filename-derived title is only a retry heuristic:
 * the embedded metadata may legitimately contain the same title.
 */
export function metadataStillFromFileName(book: LibraryBook): boolean {
  return book.format === "pdf" && book.title === parseFileName(book.fileName).title;
}

/** Retry eligibility is broader than the automatic PDF catch-up policy. */
export function metadataNeedsEnrichment(book: LibraryBook): boolean {
  const fromFile = parseFileName(book.fileName);
  return ENRICHMENT_FORMATS.has(book.format)
    && (book.title === fromFile.title || !book.author || book.author === fromFile.author);
}

/**
 * Boot / reload pass: every shelf book with an open question whose file is
 * here gets a job — a missing cover verdict, or PDF metadata never filled.
 * Legacy rows (imported before verdicts were recorded) and interrupted
 * imports are caught up this way.
 */
export function scheduleCatchUpEnrichment(books: readonly LibraryBook[]): void {
  for (const book of books) {
    if (!ENRICHMENT_FORMATS.has(book.format)) continue;
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
  if (!ENRICHMENT_FORMATS.has(book.format)) return;
  attempted.add(book.id);
  try {
    await enrichmentQueue.enqueue({ bookId: book.id, cover, metadata }, request => applyParsedBook(request, parsed), true).done;
  } catch (error) {
    log.warn(`cover from the open book failed for ${book.id}`, error);
  }
}

async function runJob(request: EnrichmentRequest): Promise<EnrichmentOutcome> {
  attempted.add(request.bookId);
  const book = await getBookRecord(request.bookId);
  if (!book) return { reason: "book-removed" };
  const needsCover = request.cover && book.coverStatus === "unchecked";
  const needsMetadata = request.metadata;
  if (!needsCover && !needsMetadata) return { reason: "not-needed" };
  if (!ENRICHMENT_FORMATS.has(book.format)) return { reason: "unsupported-format" };
  const file = await openLocalBookFile(book);
  if (!file) {
    // Not on this device (a synced-in shell): nothing to parse. The cover,
    // if the importing device found one, arrives through the hydrator.
    return { reason: "source-unavailable" };
  }
  const parsed = await makeFoliateBook(file);
  try {
    return await applyParsedBook({ ...request, cover: needsCover, metadata: needsMetadata }, parsed);
  } finally {
    await parsed.destroy?.();
  }
}

async function applyParsedBook(request: EnrichmentRequest, parsed: FoliateBook): Promise<EnrichmentOutcome> {
  const current = await getBookRecord(request.bookId);
  if (!current) return { reason: "book-removed" };
  const events = [];

  if (request.metadata) {
    const title = foliateTitle(parsed);
    const author = foliateAuthor(parsed);
    const fromFile = parseFileName(current.fileName);
    const patch = {
      ...(title && current.title === fromFile.title && title !== current.title ? { title } : {}),
      ...(author && (!current.author || current.author === fromFile.author) && author !== current.author ? { author } : {}),
    };
    if (Object.keys(patch).length > 0) {
      events.push({
        type: "book.metadataEdited" as const,
        payload: { bookId: request.bookId, ...patch },
        // Parsed-metadata enrichment is app machinery, not a user edit.
        origin: request.origin ?? "system" as const,
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
            origin: request.origin ?? "system" as const,
          }
        : {
            type: "book.coverExtracted" as const,
            payload: { bookId: request.bookId, status: "none" as const },
            origin: request.origin ?? "system" as const,
          },
    );
  }

  if (events.length === 0) return { reason: "not-needed" };
  await commitDomainEvents(...events);
  emitAppEvent("book-changed", { bookId: request.bookId });
  return { reason: null };
}

/** Sections the coverless fallback opens looking for the book's first image. */
const FALLBACK_SECTIONS = 6;
/** Shortest side an in-book image needs to pass as a cover (mirrors covers.rs). */
const FALLBACK_MIN_SIDE = 120;


/**
 * A book that declares no cover shows its first image instead: the first
 * `<img>` (or SVG `<image>`) any of the opening sections displays, provided it
 * is large enough to be artwork rather than an ornament. The engine has
 * already rewritten resource URLs to blob: URLs, so the bytes are one fetch
 * away.
 */
async function firstInBookImage(parsed: FoliateBook): Promise<Blob | null> {
  const sections = parsed.sections
    .filter((section) => section.linear !== "no" && typeof section.createDocument === "function")
    .slice(0, FALLBACK_SECTIONS);
  for (const section of sections) {
    let doc: Document;
    try {
      doc = await section.createDocument!();
    } catch {
      continue;
    }
    const element = doc.querySelector("img[src], image");
    const src =
      element?.getAttribute("src") ??
      element?.getAttribute("href") ??
      element?.getAttribute("xlink:href");
    if (!src || !src.startsWith("blob:")) continue;
    try {
      const blob = await (await fetch(src)).blob();
      if (blob.size === 0) continue;
      const bitmap = await createImageBitmap(blob);
      const shortSide = Math.min(bitmap.width, bitmap.height);
      bitmap.close();
      if (shortSide >= FALLBACK_MIN_SIDE) return blob;
    } catch {
      // Undecodable or unreachable: not a cover candidate; keep looking.
    }
  }
  return null;
}

async function storeParsedCover(bookId: string, parsed: FoliateBook): Promise<StoredCover> {
  let blob: Blob | null = null;
  try {
    blob = (await parsed.getCover?.()) ?? null;
  } catch (error) {
    log.warn(`engine could not extract a cover for ${bookId}`, error);
    throw error;
  }
  if (!blob || blob.size === 0) blob = await firstInBookImage(parsed);
  if (!blob || blob.size === 0) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<StoredCover>("library_put_cover", bytes, {
    headers: {
      "x-book-id": bookId,
      ...(blob.type ? { "x-blob-mime": blob.type } : {}),
    },
  });
}
