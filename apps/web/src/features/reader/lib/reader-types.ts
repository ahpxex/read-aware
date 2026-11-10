import type { BookFormat } from "../../library/lib/library-types";
import type { Book, BookFile } from "../../../../foliate-js/src/book";
import type { BookArchive } from "../../../../foliate-js/src/book-loader";
import type { BookTextRange } from "@read-aware/core";

/** Minimal Blob/File surface consumed by foliate's format sniffers and parsers. */
export type BookFileSource = BookFile;
/** A ZIP container (EPUB, CBZ) the native shell reads where it is stored; see `platform/book-archive.ts`. */
export type BookArchiveSource = BookArchive;
/** What a stored book is parsed from: its file, or its natively opened archive. */
export type StoredBookSource = BookFileSource | BookArchiveSource;

/** A passage targeted by a selection, stored annotation or guided-reading action. */
export type ActionTarget = {
  text: string;
  cfiRange: string | null;
  chapterHref: string | null;
  /** Only present when captured from a versioned source, never re-stamped from legacy CFI. */
  range?: BookTextRange | null;
};

export type VirtualBookRef = {
  pluginId: string;
  providerId: string;
  key: string;
};

/**
 * A book ready to be opened by an engine: parsed, its navigation usable, its
 * content version known. What the library's prepared content is to the
 * reader, stated here so this module depends on no other feature.
 */
export type PreparedBook = {
  book: Book;
  contentVersion: string;
  /** The plugin provider a virtual book's content came from. */
  provider?: object | null;
};

/**
 * A book being opened in the reader. Its content is prepared outside the
 * reader's components (see the library's book-content-source) and started the
 * moment the book was chosen, so the reader mounts and builds its engine
 * while the book is found and parsed, not before. The reading session that
 * made this object holds the lease on that content for as long as it is the
 * book in the reader; an engine re-opened for another layout reuses it.
 */
export type LoadedBook = {
  fileName: string;
  format: BookFormat;
  /** Rejects when the book could not be prepared; the reading session reports that and unmounts the reader. */
  content: Promise<PreparedBook>;
  /** Set for a plugin-provided book. */
  virtual?: VirtualBookRef;
  /** Explicit reload resets file/unknown positions; virtual source-proven unchanged sections can retain a location. */
  resetPosition?: boolean;
};

/** A flattened table-of-contents entry backing the chapter list. */
export type TocEntry = {
  id: string;
  href: string;
  label: string;
  depth: number;
  spineIndex: number;
  /** Position in the book as a 0..1 fraction, filled after href resolution. */
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
  id?: string | number;
  href?: string | null;
  label?: string;
  subitems?: TocNavItem[] | null;
};
