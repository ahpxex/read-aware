/**
 * Filter, order and page the shelf for list_books. Pure: the port returns the
 * whole shelf, and what the model sees of it is decided here.
 */
import type { BookFormat, ReadingStatus } from "@read-aware/core";
import type { BookOverview } from "../ports";

export const BOOK_LIST_SORTS = ["recent", "added", "title", "progress", "size"] as const;
export type BookListSort = (typeof BOOK_LIST_SORTS)[number];

export interface BookListQuery {
  /** Case-insensitive substring of the title, author or original file name. */
  search?: string;
  status?: ReadingStatus;
  format?: BookFormat;
  starred?: boolean;
  /** A collection id, or null for books in no collection. */
  collectionId?: string | null;
  /** false selects books whose file is not on this device (shelf entry only). */
  fileOnDevice?: boolean;
  hasAnnotations?: boolean;
  sort?: BookListSort;
  offset?: number;
  limit?: number;
}

export interface BookListPage {
  books: BookOverview[];
  /** Books matching the filters, before paging. */
  total: number;
  /** Pass as offset to continue; null when this page ends the list. */
  nextOffset: number | null;
}

/** Large enough for an ordinary shelf in one call, small enough to bound a huge one. */
export const BOOK_LIST_DEFAULT_LIMIT = 200;
export const BOOK_LIST_MAX_LIMIT = 500;

const time = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);

const ORDER: Record<BookListSort, (a: BookOverview, b: BookOverview) => number> = {
  // Never-opened books follow opened ones, newest additions first.
  recent: (a, b) => time(b.lastOpenedAt) - time(a.lastOpenedAt) || time(b.addedAt) - time(a.addedAt),
  added: (a, b) => time(b.addedAt) - time(a.addedAt),
  title: (a, b) => a.title.localeCompare(b.title),
  progress: (a, b) => (b.progressPercent ?? 0) - (a.progressPercent ?? 0),
  size: (a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0),
};

export function queryBookList(books: readonly BookOverview[], query: BookListQuery = {}): BookListPage {
  const needle = query.search?.trim().toLowerCase();
  const matching = books.filter(
    (book) =>
      (!needle || [book.title, book.author, book.fileName].some((field) => field?.toLowerCase().includes(needle))) &&
      (query.status === undefined || (book.status ?? "unread") === query.status) &&
      (query.format === undefined || book.format === query.format) &&
      (query.starred === undefined || (book.starred ?? false) === query.starred) &&
      (query.collectionId === undefined || (book.collectionId ?? null) === query.collectionId) &&
      // A virtual book has no file: it is neither "on this device" nor "missing from it".
      (query.fileOnDevice === undefined || book.fileOnDevice === query.fileOnDevice) &&
      (query.hasAnnotations === undefined || (book.annotationCount ?? 0) > 0 === query.hasAnnotations),
  );
  // The id breaks ties, so paging is stable between calls.
  const order = query.sort ? ORDER[query.sort] : undefined;
  const ordered = order ? [...matching].sort((a, b) => order(a, b) || a.id.localeCompare(b.id)) : matching;
  const offset = query.offset ?? 0;
  const page = ordered.slice(offset, offset + (query.limit ?? BOOK_LIST_DEFAULT_LIMIT));
  const next = offset + page.length;
  return { books: page, total: ordered.length, nextOffset: next < ordered.length ? next : null };
}
