// Core domain entities for the local-first reading model.
// These are plain, platform-agnostic types — no React, no storage, no I/O.

export type Id = string;

/** ISO-8601 timestamp string. */
export type IsoDate = string;

export type BookFormat = "epub" | "mobi" | "azw3" | "fb2" | "pdf";

export interface UserProfile {
  id: Id;
  displayName?: string;
  createdAt: IsoDate;
}

export interface Book {
  id: Id;
  title: string;
  author?: string;
  format: BookFormat;
  /** Storage key of the original source file (see StorageAdapter blobs). */
  sourceBlobKey: string;
  addedAt: IsoDate;
}

export interface Highlight {
  id: Id;
  bookId: Id;
  /** Anchor into the book: EPUB CFI or a PDF locator. Anchor stability matters. */
  anchor: string;
  text: string;
  createdAt: IsoDate;
}

export interface Note {
  id: Id;
  bookId?: Id;
  highlightId?: Id;
  body: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}
