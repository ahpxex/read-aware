/**
 * Prepared book content: one parsed book per library book, shared by everyone
 * who reads it.
 *
 * Preparing a book — finding its file, parsing the container, restoring or
 * repairing its navigation, learning its content version — is the same work
 * for the reader, the text extraction, search, the agent's tools and the
 * plugins. It used to be done by whoever asked: the reader inside its own
 * mount, every background query again from the file. Here it is done once per
 * content and leased:
 *
 * - `acquireBookContent` returns a lease on the prepared book. Leases of one
 *   book share one preparation, started by the first to ask, so the reader can
 *   begin it the moment a book is chosen and everything else joins it.
 * - A released file book stays prepared for a while (the most recently used
 *   few), so reopening it, switching its layout or querying it again does not
 *   parse it again.
 * - A book whose content changed — its file replaced, its content invalidated,
 *   its plugin provider replaced or removed — is prepared afresh; whoever still
 *   holds the earlier preparation keeps a working book until they release it.
 *
 * Plugin-provided (virtual) content is never kept past its last lease: a new
 * activation must resolve the provider's content again.
 */
import { ContentBudgetError } from "../../../../foliate-js/src/content-budget";
import { AppError } from "@read-aware/core";
import { onAppEvent } from "../../../platform/app-events";
import { getDesktopBlobInfo } from "../../../platform/blob-store";
import { createLogger } from "../../../platform/logger";
import { BookContentCache, type PreparedContent } from "./book-content-cache";
import { retainBook } from "../../reader/lib/book-lifetime";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { parseBookFile } from "../../reader/lib/parse-book";
import { ensureUsableToc } from "../../reader/lib/toc-synthesis";
import { buildVirtualFoliateBook } from "../../reader/lib/virtual-book";
import {
  getVirtualBookBinding,
  resolveContentProvider,
  type VirtualBookBinding,
} from "../../plugins/lib/virtual-books";
import { getBookRecord, getStoredBookFile, resolveStoredBookFile, type BookFileMissingReason } from "./library-db";
import { virtualContentVersion } from "./content-version";
import {
  assertContentNotInvalidated,
  contentInvalidationRevision,
  observeContentInvalidation,
} from "./content-invalidation";
import type { NavigationItem } from "./book-text-record";
export { virtualContentVersion } from "./content-version";

const log = createLogger("book-content");

type Provider = ReturnType<typeof resolveContentProvider>;

export type BookContent = {
  book: FoliateBook;
  contentVersion: string;
  provider?: Provider;
  providerKey?: string;
  invalidation?: string;
};

export type BookContentLease = {
  content: BookContent;
  /** Give the lease back. Idempotent. The book stays usable until every lease on it is released. */
  release(): Promise<void>;
};

/** The book's file is not on this device and could not be brought to it. */
export class BookSourceMissingError extends AppError {
  constructor(readonly reason: BookFileMissingReason) {
    super("fs/not-found", `Book source missing: ${reason}`);
  }
}

type Prepared = { book: FoliateBook; contentVersion: string };
/** What a book's content is made from: a change in any of these is another content. */
type Identity = { invalidation: string; binding: VirtualBookBinding | null; provider: Provider };

/**
 * The navigation stored with a book's extracted text, which the next opening
 * uses instead of repairing the book's own again. The text store owns it and
 * registers its reader here: it depends on this module for content, so the
 * dependency cannot run the other way.
 */
let storedNavigation: (bookId: string) => Promise<readonly NavigationItem[] | null> = async () => null;
export function provideStoredNavigation(read: typeof storedNavigation): void {
  storedNavigation = read;
}

export async function fileContentVersion(bookId: string): Promise<string> {
  const info = await getDesktopBlobInfo(`bookfile:${bookId}`);
  if (!info?.sha256) throw new AppError("library/content-unavailable", "Book source has no readable content revision");
  return `sha256:${info.sha256}`;
}

async function prepareVirtual(binding: VirtualBookBinding, provider: Provider): Promise<Prepared> {
  if (!provider) throw new AppError("library/content-unavailable", "Book content provider is unavailable");
  const value = await provider.load(binding.key);
  if (resolveContentProvider(binding) !== provider)
    throw new AppError("library/content-unavailable", "Book content provider changed while loading");
  return { book: await buildVirtualFoliateBook(value), contentVersion: await virtualContentVersion(value) };
}

async function prepareFile(bookId: string, fetchMissing: boolean): Promise<Prepared> {
  // Asked for alongside the file: it needs nothing the parse produces.
  const stored = storedNavigation(bookId).catch((error: unknown) => {
    log.warn("Stored navigation unavailable", error);
    return null;
  });
  let file;
  if (fetchMissing) {
    const resolved = await resolveStoredBookFile(bookId);
    if (resolved.status === "missing") throw new BookSourceMissingError(resolved.reason);
    file = resolved.file;
  } else {
    // Background work never drags a book off the relay: without local bytes
    // there is no content version, and this stops here.
    await fileContentVersion(bookId);
    file = await getStoredBookFile(bookId);
    if (!file) throw new AppError("fs/not-found", "Book source is missing");
  }
  const version = fileContentVersion(bookId);
  // Awaited below; a parse failure first must not leave this rejection unobserved.
  version.catch(() => {});
  const book = await parseBookFile(file);
  try {
    // Navigation repaired or rebuilt before is stored with the book's text;
    // every consumer sees that one, not a fresh repair of its own.
    await ensureUsableToc(book, { persisted: await stored });
    return { book, contentVersion: await version };
  } catch (error) {
    await Promise.resolve(book.destroy?.()).catch((closeError: unknown) =>
      log.warn("Could not close a book that failed to prepare", closeError),
    );
    throw error;
  }
}

const sameBinding = (a: VirtualBookBinding | null, b: VirtualBookBinding | null) =>
  a?.pluginId === b?.pluginId && a?.providerId === b?.providerId && a?.key === b?.key;

const cache = new BookContentCache<FoliateBook, Identity>({
  identity: (bookId) => {
    const binding = getVirtualBookBinding(bookId);
    const provider = binding ? resolveContentProvider(binding) : null;
    if (binding && !provider) throw new AppError("library/content-unavailable", "Book content provider is unavailable");
    return { invalidation: contentInvalidationRevision(bookId), binding, provider };
  },
  sameIdentity: (a, b) =>
    a.invalidation === b.invalidation && sameBinding(a.binding, b.binding) && a.provider === b.provider,
  // Plugin-provided content is resolved again by every activation.
  keepIdle: (identity) => !identity.binding,
  currentVersion: (bookId) => fileContentVersion(bookId),
  prepare: (bookId, identity, fetchMissing) =>
    identity.binding ? prepareVirtual(identity.binding, identity.provider) : prepareFile(bookId, fetchMissing),
  retain: retainBook,
  warn: (message, error) => log.warn(message, error),
});

const contentOf = (prepared: PreparedContent<FoliateBook, Identity>): BookContent => ({
  book: prepared.book,
  contentVersion: prepared.contentVersion,
  invalidation: prepared.identity.invalidation,
  ...(prepared.identity.binding
    ? { provider: prepared.identity.provider, providerKey: prepared.identity.binding.key }
    : {}),
});

/**
 * Lease the book's prepared content, preparing it if nobody has.
 *
 * `fetchMissing` lets the preparation bring a file that is not on this device
 * from the relay — the reader's choice, never a background query's.
 */
export async function acquireBookContent(
  bookId: string,
  options: { fetchMissing?: boolean; signal?: AbortSignal } = {},
): Promise<BookContentLease> {
  const lease = await cache.acquire(bookId, options);
  return { content: contentOf(lease.content), release: lease.release };
}

/**
 * Hand an already parsed book to the cache as this book's content, for the
 * tests and probes that hold their own parser. The reader does not need this:
 * it leases like everyone else.
 */
export function registerActiveBookContent(
  bookId: string,
  book: FoliateBook,
  contentVersion: string,
  provider?: Provider,
  invalidation = contentInvalidationRevision(bookId),
): () => void {
  assertContentNotInvalidated(bookId, invalidation);
  return cache.adopt(bookId, book, contentVersion, {
    invalidation,
    binding: provider ? getVirtualBookBinding(bookId) : null,
    provider: provider ?? null,
  });
}

/** Run `read` against the book's prepared content, proving before and after that it is still the book's. */
export async function withBookContent<T>(
  bookId: string,
  expectedVersion: string | undefined,
  signal: AbortSignal | undefined,
  read: (content: BookContent) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const record = await getBookRecord(bookId);
  if (!record) throw new AppError("library/book-not-found", "Book is not in the library");
  const binding = getVirtualBookBinding(bookId);
  const provider = binding ? resolveContentProvider(binding) : null;
  const invalidation = contentInvalidationRevision(bookId);
  let lease: BookContentLease | undefined;
  try {
    lease = await acquireBookContent(bookId, { signal });
    const content = lease.content;
    const check = async () => {
      signal?.throwIfAborted();
      assertContentNotInvalidated(bookId, invalidation);
      const currentBinding = getVirtualBookBinding(bookId);
      if (!sameBinding(currentBinding, binding))
        throw new AppError("reader/stale-location", "Book content binding changed");
      if (
        (expectedVersion && expectedVersion !== content.contentVersion) ||
        (!binding && (await fileContentVersion(bookId)) !== content.contentVersion)
      ) {
        throw new AppError("reader/stale-location", "Book content revision changed");
      }
      if (binding && resolveContentProvider(binding) !== provider)
        throw new AppError("library/content-unavailable", "Book content provider was replaced or removed");
      if (!(await getBookRecord(bookId)))
        throw new AppError("library/book-not-found", "Book was removed during content access");
      signal?.throwIfAborted();
      assertContentNotInvalidated(bookId, invalidation);
    };
    await check();
    const result = await read(content);
    await check();
    return result;
  } catch (error) {
    if (error instanceof ContentBudgetError) throw new AppError(error.code, error.message, { cause: error });
    throw error;
  } finally {
    await lease?.release();
  }
}

// What is kept must not outlive what it was made from.
observeContentInvalidation((bookId) => cache.retire(bookId));
onAppEvent("book-removed", ({ bookId }) => cache.retire(bookId));
