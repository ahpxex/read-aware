// Core domain entities for the local-first reading model.
// These are plain, platform-agnostic types — no React, no storage, no I/O.
// Field names and nullability are kept in lock-step with docs/sqlite-schema.sql
// (the authoritative DDL) and the event payloads in events.ts.

export type Id = string;

/** ISO-8601 timestamp string (UTC). */
export type IsoDate = string;

export type BookFormat = "epub" | "mobi" | "azw3" | "fb2" | "pdf";

/** Cover-extraction outcome; replaces the old coverChecked + coverUrl pair. */
export type CoverStatus = "unchecked" | "ready" | "none" | "failed";

export type ReadingStatus = "unread" | "reading" | "finished";

export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export type HighlightStyle = "highlight" | "underline";

/** Explicit user feedback on a long-term memory. */
export type MemoryFeedbackSignal = "pin" | "correct" | "reject";

export interface UserProfile {
  id: Id;
  displayName?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Book {
  id: Id;
  title: string;
  author?: string;
  format: BookFormat;
  /** Original import file name. */
  fileName: string;
  mimeType?: string;
  /** Original file size in bytes. */
  fileSize: number;
  /** Storage key of the original source file (see StorageAdapter blobs). */
  sourceBlobKey: string;
  /** Content hash of the source file, for duplicate detection. */
  sourceSha256?: string;
  /** Storage key of the extracted cover, if any. */
  coverBlobKey?: string;
  coverStatus: CoverStatus;
  starred: boolean;
  addedAt: IsoDate;
  updatedAt: IsoDate;
  lastOpenedAt?: IsoDate;
}

export interface Highlight {
  id: Id;
  bookId: Id;
  /**
   * Anchor into the book: EPUB CFI or a PDF locator. Anchor stability matters
   * when present; absent for formats with no stable range locator.
   */
  anchor?: string;
  chapterHref?: string;
  text: string;
  color: HighlightColor;
  style: HighlightStyle;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Note {
  id: Id;
  /** Every note currently anchors to a book selection. */
  bookId: Id;
  highlightId?: Id;
  anchor?: string;
  chapterHref?: string;
  quotedText?: string;
  body: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}
