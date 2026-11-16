/**
 * Between a book's sections and its chapters' text.
 *
 * A section is stored as its raw text (`TextPiece.text`); a chapter's text is
 * slices of those, joined and whitespace-collapsed. Block boundaries and reader
 * positions are known as raw section offsets, so both are carried across that
 * collapse here: at extraction to build each chapter's layout, and afterwards
 * to turn a position in a section into a position in a chapter.
 */
import type { BookTextRecord, ChapterSource, TextPiece } from "./book-text-record";

const WHITESPACE = /\s+/g;

/**
 * Collapse whitespace exactly as chapter text always has, and report where
 * each mark (an offset into the input) lands in the result. A mark inside
 * whitespace lands on the text that follows it; a mark with no text after it
 * lands at the end.
 */
export function collapseText(input: string, marks: readonly number[]): { text: string; at: number[] } {
  const text = input.replace(WHITESPACE, " ").trim();
  // Whitespace runs as [start, end) pairs, with the characters removed before each run's end.
  const starts: number[] = [];
  const ends: number[] = [];
  const removed: number[] = [];
  let dropped = 0;
  for (const match of input.matchAll(WHITESPACE)) {
    const start = match.index;
    const end = start + match[0].length;
    // A leading run disappears whole; any other keeps one space.
    dropped += start === 0 ? end - start : end - start - 1;
    starts.push(start);
    ends.push(end);
    removed.push(dropped);
  }
  const at = marks.map((mark) => {
    let low = 0,
      high = ends.length;
    // The first run that ends after the mark.
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ends[middle]! <= mark) low = middle + 1;
      else high = middle;
    }
    const inside = low < starts.length && starts[low]! <= mark;
    const landing = inside ? ends[low]! : mark;
    const before = inside ? low : low - 1;
    return Math.min(text.length, Math.max(0, landing - (before >= 0 ? removed[before]! : 0)));
  });
  return { text, at };
}

/** Where page text has blank lines, they separate its blocks. */
export function pageTextBlocks(text: string): number[] {
  const blocks = [0];
  for (const match of text.matchAll(/\n[^\S\n]*\n\s*/g)) blocks.push(match.index + match[0].length);
  return blocks;
}

export type ChapterPoint = { chapterIndex: number; offset: number };

/**
 * The chapter position of a raw offset in a section. `edge` says which side of
 * whitespace the offset belongs to: a start moves forward onto the text that
 * follows, an end stays right after the text that precedes. Null when that
 * part of the section is in no chapter.
 */
function chapterPoint(
  record: BookTextRecord,
  pieces: ReadonlyMap<number, TextPiece>,
  sectionIndex: number,
  raw: number,
  edge: "start" | "end",
): ChapterPoint | null {
  const piece = pieces.get(sectionIndex);
  if (!piece) return null;
  const position = Math.max(0, Math.min(piece.text.length, raw));
  // The slice holding the position: a start on a slice boundary opens the
  // slice after it, an end on one closes the slice before it.
  let found: { chapterIndex: number; source: ChapterSource } | null = null;
  for (const [chapterIndex, chapter] of record.chapters.entries())
    for (const source of chapter.sources) {
      if (source.sectionIndex !== sectionIndex) continue;
      const opened = edge === "end" && position > 0 ? source.start < position : source.start <= position;
      if (opened && (!found || source.start > found.source.start)) found = { chapterIndex, source };
    }
  if (!found || position > found.source.end) return null;
  const { chapterIndex, source } = found;
  const slice = piece.text.slice(source.start, position);
  const body = slice.trimStart();
  const text = body.replace(WHITESPACE, " ").trimEnd();
  // A start moves past the single space that whitespace after the text became.
  const followsWhitespace = position >= source.end || /\s/.test(piece.text[position]!) || body.length > body.trimEnd().length;
  const offset = source.at + text.length + (edge === "start" && text.length > 0 && followsWhitespace ? 1 : 0);
  return { chapterIndex, offset: Math.min(record.chapters[chapterIndex]!.text.length, offset) };
}

/** The chapter positions of a raw range [start, end) in one section, or null when the record holds no such text. */
export function locateInRecord(
  record: BookTextRecord,
  sectionIndex: number,
  start: number,
  end: number,
): { start: ChapterPoint; end: ChapterPoint } | null {
  const pieces = new Map(record.pieces.map((piece) => [piece.sectionIndex, piece]));
  const from = chapterPoint(record, pieces, sectionIndex, start, "start");
  if (!from) return null;
  const to = end > start ? chapterPoint(record, pieces, sectionIndex, end, "end") : null;
  // An empty range, or one whose end collapses before its start, is a point.
  if (!to || to.chapterIndex < from.chapterIndex || (to.chapterIndex === from.chapterIndex && to.offset < from.offset))
    return { start: from, end: from };
  return { start: from, end: to };
}
