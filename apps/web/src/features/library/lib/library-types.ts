import type { BookFormat } from "@read-aware/core";

export type { BookFormat };

/**
 * A user-picked source. Desktop keeps the native path so Rust can copy it
 * directly; mobile/web retain a File because content URIs and input elements
 * do not expose a durable filesystem path to the frontend.
 */
export type BookImportSource =
  | { kind: "native-path"; path: string; name: string; size: number }
  | { kind: "file"; file: File };

export type ReadingStatus = "unread" | "reading" | "finished";

/**
 * Reading position for any format. Reflowable books (EPUB/MOBI/AZW3/FB2) carry a
 * CFI anchor; fixed-layout books (PDF) leave `cfi` null and rely on the location
 * index. `currentLocation`/`totalLocations` drive the "page/loc X of N" readout.
 */
export type ReaderProgress = {
  currentLocation: number;
  totalLocations: number;
  progressPercent: number;
  cfi: string | null;
  href: string | null;
};

export type BookProgress = ReaderProgress | null;

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  mimeType: string;
  fileSize: number;
  coverUrl?: string | null;
  /**
   * Whether cover extraction has been attempted. A false/absent value is
   * enriched from the reader's parsed book on first open; true also covers the
   * terminal "this file has no cover" result.
   */
  coverChecked?: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  progressPercent: number;
  readingStatus: ReadingStatus;
  progress: BookProgress;
  /** Pinned to the front of the shelf. Absent on legacy records (treated false). */
  starred?: boolean;
  /** The collection this book belongs to, or null/absent when ungrouped. */
  collectionId?: string | null;
}

/**
 * User-editable bibliographic fields, for correcting metadata that auto-detection
 * got wrong or couldn't read. Only existing `LibraryBook` fields — no schema change.
 */
export type BookMetadataPatch = {
  title?: string;
  author?: string;
};

/** A user-defined collection (single-membership folder) of books. */
export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface StoredBookFile {
  bookId: string;
  blob: Blob;
}

export type ShelfSection = {
  label: string;
  books: LibraryBook[];
};
