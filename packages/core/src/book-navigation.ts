import type { ReadingLocation } from "./reading-session";
import type { BookTextRange } from "./book-range";

/** Navigation TOC order is not the extracted-text chapter index or printed numbering. */
export type BookTocEntry = {
  id: string;
  label: string;
  ordinal: number;
  sectionIndex: number | null;
  location: ReadingLocation | null;
  children: BookTocEntry[];
};
export type BookNavigationToc = {
  bookId: string;
  contentVersion: string;
  entries: BookTocEntry[];
};
export type BookLocationSearch = {
  bookId: string;
  query: string;
  matchCase?: boolean;
  wholeWords?: boolean;
  limit?: number;
  cursor?: string;
  contentVersion?: string;
  /** When supplied, only the sections resolved by these hrefs are searched. */
  hrefs?: string[];
};
export type BookLocationHit = {
  id: string;
  sectionIndex: number;
  excerpt: { pre: string; match: string; post: string };
  /**
   * The whole text of the block the match is in, when that block is short (at
   * most 200 characters): a heading, a line of a contents page, a caption, a
   * line of dialogue. It tells a match that is a chapter's title from the same
   * words in a paragraph. Absent for a match in running text, and for content
   * without block structure (PDF text).
   */
  blockText?: string;
  location: ReadingLocation;
  /** Exact text identity usable by library.readRange without moving the reader. */
  range: BookTextRange;
};
export type BookLocationSearchPage = {
  bookId: string;
  contentVersion: string;
  hits: BookLocationHit[];
  nextCursor: string | null;
  /** Partial means no text found yet, but unscanned or unsupported sections remain. */
  textStatus: "available" | "textless" | "unsupported" | "unsearched" | "partial";
  scannedSections: number;
  totalSections: number;
};
