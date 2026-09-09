import type { BookTextSnapshot } from "@read-aware/core";

export interface ExtractedChapter { title?: string; text: string; hrefs?: string[] }
export type TextPiece = { sectionIndex: number; href?: string; text: string };
export type TextFailure = { sectionIndex: number; code: string };

/** v3/v4 cannot prove completeness or source identity; rebuild lazily, never upgrade their verdict. */
export type BookTextRecord = {
  version: 5;
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
};

export function textProgress(record: BookTextRecord): NonNullable<BookTextSnapshot["progress"]> {
  return { total: record.required.length, completed: record.pieces.length,
    failed: record.failures.length, unsupported: record.unsupported.length };
}

export function sectionsComplete(record: BookTextRecord): boolean {
  return record.required.length > 0 && record.pieces.length === record.required.length;
}

export function textComplete(record: BookTextRecord): boolean {
  return record.finalized && sectionsComplete(record);
}

export function snapshotFromText(record: BookTextRecord): BookTextSnapshot {
  const complete = textComplete(record);
  const hasText = record.pieces.some(piece => piece.text.length > 0);
  return { bookId: record.bookId, contentVersion: record.contentVersion,
    status: complete ? "ready" : record.required.length === 0 || record.unsupported.length === record.required.length ? "unsupported" : "partial",
    text: hasText ? "available" : complete ? "textless" : "unknown",
    chapterCount: complete ? record.chapters.length : 0, progress: textProgress(record),
    ...(record.failures[0] ? { errorCode: record.failures[0].code } : {}) };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** A malformed checkpoint must not turn a missing/failed section into a successful read. */
export function parseBookTextRecord(value: unknown, bookId: string, contentVersion: string): BookTextRecord | null {
  if (!object(value) || value.version !== 5 || value.bookId !== bookId || value.contentVersion !== contentVersion
    || typeof value.extractedAt !== "string" || typeof value.finalized !== "boolean" || !integer(value.sectionCount)
    || !Array.isArray(value.required) || !Array.isArray(value.pieces) || !Array.isArray(value.failures)
    || !Array.isArray(value.unsupported) || !Array.isArray(value.chapters)) return null;
  const sectionCount = value.sectionCount;
  const validIndex = (index: unknown): index is number => integer(index) && index < sectionCount;
  if (!value.required.every(validIndex) || new Set(value.required).size !== value.required.length) return null;
  const required = new Set(value.required);
  const occupied = new Set<number>();
  const claim = (index: unknown) => {
    if (!validIndex(index) || !required.has(index) || occupied.has(index)) return false;
    occupied.add(index); return true;
  };
  if (!value.pieces.every(piece => object(piece) && claim(piece.sectionIndex) && typeof piece.text === "string"
    && (piece.href === undefined || typeof piece.href === "string"))) return null;
  if (!value.failures.every(failure => object(failure) && claim(failure.sectionIndex) && typeof failure.code === "string" && failure.code.length > 0)) return null;
  if (!value.unsupported.every(claim)) return null;
  if (!value.chapters.every(chapter => object(chapter) && typeof chapter.text === "string"
    && (chapter.title === undefined || typeof chapter.title === "string")
    && (chapter.hrefs === undefined || strings(chapter.hrefs)))) return null;
  if (value.finalized && (value.required.length === 0 || value.pieces.length !== value.required.length)
    || !value.finalized && value.chapters.length > 0) return null;
  return value as BookTextRecord;
}
