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
  DictionaryEntrySnapshot,
  HighlightColor,
  HighlightStyle,
  Id,
  IsoDate,
  ReadingStatus,
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
}

export interface CollectionSummary {
  id: Id;
  name: string;
  createdAt: IsoDate;
}

export interface HighlightItem {
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

/** A vocabulary-notebook entry as the vocabulary domain lists it. */
export interface VocabularySummary {
  term: string;
  /** Explanation language (human-readable name). */
  language: string;
  /** One-line rendering of the first sense, part of speech prefixed. */
  definition: string;
  entry: DictionaryEntrySnapshot;
  context?: string;
  bookId?: Id;
  bookTitle?: string;
  addedAt: IsoDate;
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
