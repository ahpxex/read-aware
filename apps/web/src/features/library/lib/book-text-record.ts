import type { BookTextSnapshot } from "@read-aware/core";
import type { SectionOutline } from "../../reader";

export interface ExtractedChapter {
  title?: string;
  text: string;
  hrefs?: string[];
}
export type TextBoundary = { offset: number; href: string; title?: string };
export type TextPiece = {
  sectionIndex: number;
  href?: string;
  text: string;
  starts: TextBoundary[];
  anchors: { offset: number; href: string }[];
  /** Headings read for navigation the opening left to extraction to rebuild. */
  outline?: SectionOutline;
};
/** A stored navigation entry. */
export type NavigationItem = { label: string; href: string; subitems?: NavigationItem[] };
export type TextFailure = { sectionIndex: number; code: string };

/** v9 follows the chapter map (reading order, chapter level; see foliate-js chapter-map.ts) over
 * navigation repaired or rebuilt from headings by toc-synthesis.ts — at open, or here when the book
 * was too large to rebuild then — and stores that navigation. Earlier records have incompatible
 * chapter coordinates; rebuild lazily. */
export type BookTextRecord = {
  version: 9;
  bookId: string;
  contentVersion: string;
  extractedAt: string;
  finalized: boolean;
  sectionCount: number;
  required: number[];
  pieces: TextPiece[];
  failures: TextFailure[];
  unsupported: number[];
  chapters: ExtractedChapter[];
  /** Navigation the book's own lacked or had wrong: repaired or rebuilt from headings (toc-synthesis.ts),
   * or recovered from a paged book's page headings (page-headings.ts). The next opening uses it as is. */
  outline?: NavigationItem[];
};

export function textProgress(record: BookTextRecord): NonNullable<BookTextSnapshot["progress"]> {
  return {
    total: record.required.length,
    completed: record.pieces.length,
    failed: record.failures.length,
    unsupported: record.unsupported.length,
  };
}

export function sectionsComplete(record: BookTextRecord): boolean {
  return record.required.length > 0 && record.pieces.length === record.required.length;
}

export function textComplete(record: BookTextRecord): boolean {
  return record.finalized && sectionsComplete(record);
}

export function snapshotFromText(record: BookTextRecord): BookTextSnapshot {
  const complete = textComplete(record);
  const hasText = record.pieces.some((piece) => piece.text.trim().length > 0);
  return {
    bookId: record.bookId,
    contentVersion: record.contentVersion,
    status: complete
      ? "ready"
      : record.required.length === 0 || record.unsupported.length === record.required.length
        ? "unsupported"
        : "partial",
    text: hasText ? "available" : complete ? "textless" : "unknown",
    chapterCount: complete ? record.chapters.length : 0,
    progress: textProgress(record),
    ...(record.failures[0] ? { errorCode: record.failures[0].code } : {}),
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Navigation nests as deep as books do; a tree deeper than this is not a navigation. */
const MAX_NAVIGATION_DEPTH = 32;
function navigationItemsValid(value: unknown, depth: number): boolean {
  return (
    depth < MAX_NAVIGATION_DEPTH &&
    Array.isArray(value) &&
    value.every(
      (entry) =>
        object(entry) &&
        typeof entry.label === "string" &&
        typeof entry.href === "string" &&
        (entry.subitems === undefined || navigationItemsValid(entry.subitems, depth + 1)),
    )
  );
}
/**
 * The navigation stored with a book's complete text, kept beside it: what
 * opening the book needs from the record, without the megabytes of text the
 * record carries. `outline` is null when the book's own navigation needed no
 * repair. It is a copy; the record stays the authority.
 */
export type StoredNavigation = { contentVersion: string; outline: NavigationItem[] | null };

export function storedNavigationOf(record: BookTextRecord): StoredNavigation | null {
  return textComplete(record) ? { contentVersion: record.contentVersion, outline: record.outline ?? null } : null;
}

/** A malformed copy is no copy: the caller reads the record instead. */
export function parseStoredNavigation(value: unknown): StoredNavigation | null {
  return object(value) &&
    typeof value.contentVersion === "string" &&
    value.contentVersion &&
    (value.outline === null || navigationItemsValid(value.outline, 0))
    ? { contentVersion: value.contentVersion, outline: value.outline as NavigationItem[] | null }
    : null;
}

function outlineValid(value: unknown): boolean {
  return (
    object(value) &&
    Array.isArray(value.lead) &&
    value.lead.every((line) => typeof line === "string") &&
    Array.isArray(value.headings) &&
    value.headings.every(
      (heading) =>
        object(heading) &&
        integer(heading.level) &&
        typeof heading.text === "string" &&
        (heading.id === null || typeof heading.id === "string") &&
        integer(heading.offset),
    )
  );
}

/** A malformed checkpoint must not turn a missing/failed section into a successful read. */
export function parseBookTextRecord(value: unknown, bookId: string, contentVersion: string): BookTextRecord | null {
  if (
    !object(value) ||
    value.version !== 9 ||
    value.bookId !== bookId ||
    value.contentVersion !== contentVersion ||
    typeof value.extractedAt !== "string" ||
    typeof value.finalized !== "boolean" ||
    !integer(value.sectionCount) ||
    !Array.isArray(value.required) ||
    !Array.isArray(value.pieces) ||
    !Array.isArray(value.failures) ||
    !Array.isArray(value.unsupported) ||
    !Array.isArray(value.chapters)
  )
    return null;
  const sectionCount = value.sectionCount;
  const validIndex = (index: unknown): index is number => integer(index) && index < sectionCount;
  if (!value.required.every(validIndex) || new Set(value.required).size !== value.required.length) return null;
  const required = new Set(value.required);
  const occupied = new Set<number>();
  const claim = (index: unknown) => {
    if (!validIndex(index) || !required.has(index) || occupied.has(index)) return false;
    occupied.add(index);
    return true;
  };
  if (
    !value.pieces.every(
      (piece) =>
        object(piece) &&
        claim(piece.sectionIndex) &&
        typeof piece.text === "string" &&
        (piece.href === undefined || typeof piece.href === "string") &&
        Array.isArray(piece.starts) &&
        Array.isArray(piece.anchors) &&
        [...piece.starts, ...piece.anchors].every(
          (point) =>
            object(point) &&
            integer(point.offset) &&
            point.offset <= (piece.text as string).length &&
            typeof point.href === "string" &&
            (point.title === undefined || typeof point.title === "string"),
        ),
    )
  )
    return null;
  if (
    !value.failures.every(
      (failure) =>
        object(failure) && claim(failure.sectionIndex) && typeof failure.code === "string" && failure.code.length > 0,
    )
  )
    return null;
  if (!value.unsupported.every(claim)) return null;
  if (
    !value.chapters.every(
      (chapter) =>
        object(chapter) &&
        typeof chapter.text === "string" &&
        (chapter.title === undefined || typeof chapter.title === "string") &&
        (chapter.hrefs === undefined || strings(chapter.hrefs)),
    )
  )
    return null;
  if (value.outline !== undefined && !navigationItemsValid(value.outline, 0)) return null;
  if (
    !value.pieces.every(
      (piece) =>
        (piece as { outline?: unknown }).outline === undefined ||
        outlineValid((piece as { outline?: unknown }).outline),
    )
  )
    return null;
  if (
    (value.finalized && (value.required.length === 0 || value.pieces.length !== value.required.length)) ||
    (!value.finalized && value.chapters.length > 0)
  )
    return null;
  return value as BookTextRecord;
}
