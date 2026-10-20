import type { BookTextRange } from "./book-range";
// Canonical domain READ MODELS — the shapes any programmatic actor (the
// plugin runtime, the agent's ports, and eventually the app UI) receives
// when reading a domain. They mirror the projection tables (interim or
// SQLite) minus device-local storage internals (blob keys, hashes).
//
// One vocabulary, three consumers: @read-aware/plugin-types re-exports these
// under its public Plugin* names, and @read-aware/agent builds its port
// views from them — so shape drift between the surfaces is a type error,
// not a code-review hope.

import type {
  BookFormat,
  HighlightColor,
  HighlightStyle,
  Id,
  IsoDate,
  ReadingStatus,
  UserFontFormat,
} from "./entities";

/** A shelf book as the books domain lists it. */
export interface BookSummary {
  id: Id;
  title: string;
  author?: string;
  format: BookFormat;
  starred: boolean;
  /** Single-membership collection, or null when ungrouped. */
  collectionId: string | null;
  addedAt: IsoDate;
  updatedAt: IsoDate;
  lastOpenedAt?: IsoDate;
  /** Original import file name/size; absent on virtual books. */
  fileName?: string;
  fileSize?: number;
  /** Folder-relative origin of a folder import (`Books/Sci-fi/Dune.epub`); absent otherwise. */
  sourcePath?: string;
  /**
   * Digest organization (people/events versus concepts), written
   * by the idle classification pipeline. Absent = not yet classified.
   */
  narrativity?: "narrative" | "expository";
  /** Independent protection for fictional plot revelations. */
  spoilerSensitive?: boolean;
}

export interface CollectionSummary {
  id: Id;
  name: string;
  createdAt: IsoDate;
}

/** A user-imported font as the settings domain lists it (no blob internals). */
export interface UserFontSummary {
  id: Id;
  /** Parsed family/display name from the font's name table. */
  name: string;
  format: UserFontFormat;
  /** Original picked file name (secondary label). */
  fileName: string;
  byteSize: number;
  /** OS/2 usWeightClass of the default instance (100–900). */
  weight: number;
  /** Variable fonts: the fvar `wght` axis upper bound, when present. */
  weightMax?: number;
  italic: boolean;
  createdAt: IsoDate;
}

export interface HighlightItem {
  /** Validated source at creation; absent on legacy/unanchored annotations. */
  range?: BookTextRange;
  kind: "highlight";
  id: Id;
  bookId: Id;
  text: string;
  /** Range anchor (EPUB CFI / PDF locator); absent when unanchorable. */
  anchor?: string;
  chapterHref?: string;
  color: HighlightColor;
  style: HighlightStyle;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface NoteItem {
  /** Validated source at creation; absent on legacy/unanchored annotations. */
  range?: BookTextRange;
  kind: "note";
  id: Id;
  bookId: Id;
  /** The passage the note anchors to, when it quotes one. */
  quotedText?: string;
  body: string;
  anchor?: string;
  chapterHref?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** A passive trace of a question asked in the book thread (agent-written). */
export interface AskItem {
  kind: "ask";
  id: Id;
  bookId: Id;
  text: string;
  anchor?: string;
  chapterHref?: string;
  createdAt: IsoDate;
}

export type AnnotationItem = HighlightItem | NoteItem | AskItem;

/** Current reading position and status of one book. */
export interface ReadingState {
  bookId: Id;
  /** 0..100. */
  progressPercent: number;
  status: ReadingStatus;
  /** Format-neutral position (EPUB CFI or PDF locator), when recorded. */
  locator?: string;
  chapterHref?: string;
  currentLocation?: number;
  totalLocations?: number;
}

/** Accumulated active reading time of one book. */
export interface ReadingTime {
  bookId: Id;
  totalMs: number;
  firstReadAt?: IsoDate;
  lastReadAt?: IsoDate;
  /** Active ms per local day, keyed YYYY-MM-DD. */
  daily: Record<string, number>;
}

/** One book through the shelf's stats face: position, status, and time. */
export interface BookStats extends ReadingState {
  totalMs: number;
  firstReadAt?: IsoDate;
  lastReadAt?: IsoDate;
  /** Active ms per local day, keyed YYYY-MM-DD. */
  daily: Record<string, number>;
}

/** Whole-shelf aggregate over every book's recorded reading. */
export interface StatsOverview {
  totalMs: number;
  /** Active ms per local day across all books, keyed YYYY-MM-DD. */
  daily: Record<string, number>;
  firstReadAt?: IsoDate;
  lastReadAt?: IsoDate;
  /** Books currently in progress (status "reading"). */
  booksReading: number;
  booksFinished: number;
}

/** One turn of an AI thread as the conversations domain lists it. */
export interface ChatMessageSummary {
  id: Id;
  role: "user" | "assistant";
  content: string;
  createdAt: IsoDate;
}

export interface ThreadSummary {
  id: Id;
  title?: string;
  updatedAt?: IsoDate;
}

/** One chapter of a book's extracted text (content-layer read). */
export interface ChapterRef {
  index: number;
  title?: string;
  /** Plain-text length, for budgeting reads. */
  chars: number;
}
