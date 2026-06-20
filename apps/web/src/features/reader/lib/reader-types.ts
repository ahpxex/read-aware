import type { BookFormat } from "../../library/lib/library-types";

/**
 * A book file pulled from local storage, ready to hand to the foliate engine
 * (`makeBook`). foliate auto-detects the format from the bytes, but we keep the
 * stored `format` for routing/UX. The raw `Blob` is passed straight through —
 * no ArrayBuffer copy.
 */
export type LoadedBook = {
  fileName: string;
  format: BookFormat;
  file: Blob;
};

/** A flattened table-of-contents entry backing the chapter list. */
export type TocEntry = {
  id: string;
  href: string;
  label: string;
  depth: number;
  spineIndex: number;
};

/** A reading-order content document reference (foliate section index). */
export type SpineEntry = {
  href: string;
  index: number;
};

/** A nested navigation item as produced by a book's table of contents. */
export type TocNavItem = {
  id?: string;
  href?: string;
  label?: string;
  subitems?: TocNavItem[];
};
