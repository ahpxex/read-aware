import type { BookFormat } from "../../library/lib/library-types";

/** Minimal Blob/File surface consumed by foliate's format sniffers and parsers. */
export interface BookFileSource {
  readonly name?: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): BookFileSource;
}

/**
 * A book file pulled from local storage, ready to hand to the foliate engine
 * (`makeBook`). foliate auto-detects the format from the bytes, but we keep the
 * stored `format` for routing/UX. PDFs use a native random-access source so
 * PDF.js can request byte ranges; other formats currently pass a normal Blob.
 */
export type VirtualBookRef = {
  pluginId: string;
  providerId: string;
  key: string;
};

export type LoadedBook = {
  fileName: string;
  format: BookFormat;
  /** Absent for virtual books (content comes from a plugin provider). */
  file?: BookFileSource;
  virtual?: VirtualBookRef;
};

/** A flattened table-of-contents entry backing the chapter list. */
export type TocEntry = {
  id: string;
  href: string;
  label: string;
  depth: number;
  spineIndex: number;
  /** Position in the book as a 0..1 fraction (the scale `goToFraction` uses).
   *  Absent when the engine cannot place the entry synchronously — see
   *  `attachTocFractions`. */
  fraction?: number;
};

/**
 * Transient viewport snapshot sampled from foliate's relocate event. This is
 * live reading context for the agent, not durable reading progress.
 */
export type ReadingCursor = {
  anchor?: string;
  chapter?: string;
  chapterTitle?: string;
  bookProgress?: number;
  chapterProgress?: number;
  location?: { current: number; total: number };
  visibleText?: string;
};

/** A nested navigation item as produced by a book's table of contents. */
export type TocNavItem = {
  id?: string;
  href?: string;
  label?: string;
  subitems?: TocNavItem[];
};
