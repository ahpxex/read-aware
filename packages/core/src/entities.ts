// Core domain entities for the local-first reading model.
// These are plain, platform-agnostic types — no React, no storage, no I/O.
// Field names and nullability follow the runtime migrations in
// apps/desktop/src-tauri/src/storage/schema.rs
// (the authoritative DDL) and the event payloads in events.ts.

export type Id = string;

/** ISO-8601 timestamp string (UTC). */
export type IsoDate = string;

/**
 * "virtual" marks a plugin-provided book: no imported file, content served by
 * a registered content provider at open time.
 */
export type BookFormat = "epub" | "mobi" | "azw3" | "fb2" | "cbz" | "cbr" | "txt" | "html" | "pdf" | "virtual";

/** Cover-extraction outcome; replaces the old coverChecked + coverUrl pair. */
export type CoverStatus = "unchecked" | "ready" | "none" | "failed";

export type ReadingStatus = "unread" | "reading" | "finished";

export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export type HighlightStyle = "highlight" | "underline";

/** Explicit user feedback on a long-term memory. */
export type MemoryFeedbackSignal = "pin" | "unpin" | "correct" | "reject";

/**
 * Which software actor produced an event, orthogonal to `actorId` (operator
 * identity). "user" = a direct user action through the app UI; "agent" = the
 * reading agent's runtime; "system" = background machinery (cover extraction,
 * migrations); "plugin:<id>" = a plugin write through the plugin data API.
 */
export type EventOrigin = "user" | "agent" | "system" | `plugin:${string}`;

/**
 * Snapshot of a dictionary entry as produced by the dictionary service. Structurally
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
  /** Folder-relative origin of a folder import (`Books/Sci-fi/Dune.epub`). */
  sourcePath?: string;
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

/**
 * Font containers the import accepts, detected from magic bytes — never
 * from the file's extension. `ttc` is a TrueType/OpenType collection; the
 * reader renders its first face, which is also the face metadata describes.
 */
export type UserFontFormat = "ttf" | "otf" | "ttc" | "woff" | "woff2";

/**
 * A font file the user imported into the app — the mobile replacement for
 * enumerating OS-installed families (which mobile platforms cannot do).
 * Bytes travel as a synced blob; this entity is the synchronized registry.
 * The same file imported on two devices is the same font: `id` is its
 * content hash, so concurrent imports converge and re-import is idempotent.
 */
export interface UserFont {
  /** Content hash (sha256 hex) — the font's identity and dedup key. */
  id: Id;
  /** Parsed family/display name from the font's name table. */
  name: string;
  format: UserFontFormat;
  /** Original picked file name (secondary label/diagnostics). */
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  /** Blob-store key of the font bytes (`userfont:<sha256>`). */
  blobKey: string;
  /** OS/2 usWeightClass of the default instance (100–900). */
  weight: number;
  /** Variable fonts: the fvar `wght` axis upper bound, when present. */
  weightMax?: number;
  italic: boolean;
  createdAt: IsoDate;
}
