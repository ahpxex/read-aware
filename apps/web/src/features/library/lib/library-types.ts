import type { BookFormat } from "@read-aware/core";

export type { BookFormat };

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
   * Whether cover extraction has been attempted. Distinguishes "never tried"
   * (legacy record or transient import failure — eligible for re-extraction)
   * from "tried, file has no cover" (terminal — skip to avoid re-parsing the
   * source on every library load).
   */
  coverChecked?: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  progressPercent: number;
  readingStatus: ReadingStatus;
  progress: BookProgress;
}

export interface StoredBookFile {
  bookId: string;
  blob: Blob;
}

export type ShelfSection = {
  label: string;
  books: LibraryBook[];
};
