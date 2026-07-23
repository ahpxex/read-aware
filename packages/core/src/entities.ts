// Core domain entities for the local-first reading model.
// These are plain, platform-agnostic types — no React, no storage, no I/O.
// Field names and nullability are kept in lock-step with docs/sqlite-schema.sql
// (the authoritative DDL) and the event payloads in events.ts.

export type Id = string;

/** ISO-8601 timestamp string (UTC). */
export type IsoDate = string;

/**
 * "virtual" marks a plugin-provided book: no imported file, content served by
 * a registered content provider at open time.
 */
export type BookFormat = "epub" | "mobi" | "azw3" | "fb2" | "pdf" | "virtual";

/** Cover-extraction outcome; replaces the old coverChecked + coverUrl pair. */
export type CoverStatus = "unchecked" | "ready" | "none" | "failed";

export type ReadingStatus = "unread" | "reading" | "finished";

export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export type HighlightStyle = "highlight" | "underline";

/** Explicit user feedback on a long-term memory. */
export type MemoryFeedbackSignal = "pin" | "correct" | "reject";

/**
 * Which software actor produced an event, orthogonal to `actorId` (operator
 * identity). "user" = a direct user action through the app UI; "agent" = the
 * reading agent's runtime; "system" = background machinery (cover extraction,
 * migrations); "plugin:<id>" = a plugin write through the plugin data API.
 */
export type EventOrigin = "user" | "agent" | "system" | `plugin:${string}`;

/**
 * Snapshot of a dictionary entry as embedded in vocabulary events. Structurally
 * mirrors the dictionary feature's entry shape — the log must stay
 * self-contained, so the payload carries the full snapshot instead of a
 * reference into a rebuildable cache.
 */
export interface DictionaryEntrySnapshot {
  headword: string;
  pronunciation?: string;
  senses: { partOfSpeech: string; definition: string; examples: string[] }[];
  etymology?: string;
  contextualMeaning?: string;
}

/**
 * A saved vocabulary-notebook entry (the store the reader's dictionary saves
 * into). Identity is `id` = `<language> <term.lowercase>` — re-adding the same
 * term replaces the snapshot.
 */
export interface VocabularyEntry {
  id: Id;
  term: string;
  language: string;
  entry: DictionaryEntrySnapshot;
  /** The passage the word was met in, when known. */
  context?: string;
  bookId?: Id;
  bookTitle?: string;
  addedAt: IsoDate;
}

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
  /** Storage key of the original source file in the blob store. */
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
