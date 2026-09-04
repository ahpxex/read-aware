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
 * The cover verdict, projected from `book.coverExtracted`:
 * - `unchecked` — no device has decided yet (the engine job will)
 * - `ready`     — a `cover:` blob exists (here or on the relay)
 * - `none`      — the book was inspected and carries no cover
 */
export type CoverStatus = "unchecked" | "ready" | "none";

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

/** The `books` projection row as Rust serves it (no derived fields). */
export interface LibraryBookRow {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  mimeType: string;
  fileSize: number;
  coverStatus: CoverStatus;
  /** Blob key of the cover (`cover:<id>`) when `coverStatus` is `ready`. */
  coverBlobKey: string | null;
  /** Whether the cover bytes are on this device (false = still on the relay). */
  coverLocal: boolean;
  /** Content hash of the local cover bytes; busts the image cache on re-extraction. */
  coverVersion: string | null;
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
  /**
   * Narrativity classification (book.narrativityClassified projection):
   * narrative books get the spoiler fence and a character graph, expository
   * books an unfenced concept graph. Absent/null = not yet classified.
   */
  narrativity?: "narrative" | "expository" | null;
}

/**
 * A shelf book: the projection row plus the one derived field every surface
 * paints — the cover URL (`rablob://…`, resolved by the shell straight from
 * the blob store; null until the bytes are here). Stories and fixtures set
 * `coverUrl` directly.
 */
export interface LibraryBook extends LibraryBookRow {
  coverUrl: string | null;
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

export type ShelfSection = {
  label: string;
  books: LibraryBook[];
};
