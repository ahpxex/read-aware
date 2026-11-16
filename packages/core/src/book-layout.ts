/**
 * Reading coordinates inside a chapter: chapter → block → sentence.
 *
 * A chapter's extracted text stays one string (search, digests and every other
 * consumer read it unchanged). The layout is two ascending tables of start
 * offsets into that string, so an address is found by binary search and its
 * text is a slice. A reader position, a selection and a search hit all reduce
 * to an offset first, then to the same address.
 */

export type ChapterLayout = {
  /** What one block is in this chapter's source: a paragraph-level block, or a page of a paged book. */
  unit: "paragraph" | "page";
  /** Start offset of each block, ascending; the first is 0. */
  paragraphs: number[];
  /** Start offset of each sentence, ascending. Every block start is also a sentence start. */
  sentences: number[];
  /** Blocks that are headings, by block index. */
  headings?: ChapterHeading[];
};
export type ChapterHeading = { paragraph: number; level: number };

/** Zero-based block in the chapter, and zero-based sentence inside that block. */
export type BookAddress = { paragraph: number; sentence: number };
/** A stretch of one chapter, from the sentence it starts in through the sentence it ends in. */
export type BookSpan = { chapterIndex: number; start: BookAddress; end: BookAddress };

/** A character position in a chapter's extracted text. */
export type ChapterPoint = { chapterIndex: number; offset: number };
/** Where a reader range lies in extracted text. A viewport can begin in one chapter and end in the next. */
export type BookTextLocation = { start: ChapterPoint; end: ChapterPoint };

/** No addressable unit is longer than this, so a bounded read can always stop on a unit boundary. */
export const MAX_SENTENCE_CHARS = 1200;

type SentenceSegmenter = { segment(text: string): Iterable<{ segment: string; index: number }> };
const SegmenterClass = (
  Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: "sentence" }) => SentenceSegmenter }
).Segmenter;
const segmenters = new Map<string, SentenceSegmenter>();
function sentenceSegmenter(locale?: string): SentenceSegmenter {
  const key = locale ?? "";
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    try {
      segmenter = new SegmenterClass(locale, { granularity: "sentence" });
    } catch {
      // A book may declare a language tag the platform does not know.
      segmenter = new SegmenterClass(undefined, { granularity: "sentence" });
    }
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

const splitsPair = (text: string, offset: number) => {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
};

/** Index of the last entry that is <= value, or -1. */
function lastAtOrBefore(table: readonly number[], value: number): number {
  let low = 0,
    high = table.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Index of the first entry that is >= value, or table.length. */
function firstAtOrAfter(table: readonly number[], value: number): number {
  let low = 0,
    high = table.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Build a chapter's layout from the offsets where its blocks start.
 * Starts outside the text, duplicates and starts that open no text are dropped;
 * text before the first start belongs to a block of its own.
 */
export function buildChapterLayout(
  text: string,
  starts: readonly number[],
  options: { unit?: ChapterLayout["unit"]; headings?: readonly { offset: number; level: number }[]; locale?: string } = {},
): ChapterLayout {
  const paragraphs = [
    ...new Set([0, ...starts.filter((start) => Number.isSafeInteger(start) && start > 0 && start < text.length)]),
  ].sort((a, b) => a - b);
  const segmenter = sentenceSegmenter(options.locale);
  const sentences: number[] = [];
  for (const [index, start] of paragraphs.entries()) {
    const end = paragraphs[index + 1] ?? text.length;
    const block = text.slice(start, end);
    let opened = false;
    for (const { segment, index: at } of segmenter.segment(block)) {
      // Whitespace between sentences stays with the sentence before it.
      if (opened && !segment.trim()) continue;
      opened = true;
      for (let offset = 0; offset < segment.length; ) {
        sentences.push(start + at + offset);
        let next = Math.min(segment.length, offset + MAX_SENTENCE_CHARS);
        if (next < segment.length && splitsPair(segment, next)) next--;
        offset = next;
      }
    }
    // A block of nothing but its own start (possible only for an empty chapter).
    if (!opened) sentences.push(start);
  }
  const headingAt = new Map<number, number>();
  for (const heading of options.headings ?? []) {
    const paragraph = paragraphs.indexOf(heading.offset);
    if (paragraph >= 0 && Number.isSafeInteger(heading.level) && heading.level >= 1 && heading.level <= 6)
      headingAt.set(paragraph, heading.level);
  }
  return {
    unit: options.unit ?? "paragraph",
    paragraphs,
    sentences,
    ...(headingAt.size
      ? { headings: [...headingAt].map(([paragraph, level]) => ({ paragraph, level })).sort((a, b) => a.paragraph - b.paragraph) }
      : {}),
  };
}

const ascending = (table: unknown, textLength: number): table is number[] =>
  Array.isArray(table) &&
  table.length > 0 &&
  table[0] === 0 &&
  table.every(
    (value, index) =>
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      (value < textLength || (value === 0 && textLength === 0)) &&
      (index === 0 || value > (table[index - 1] as number)),
  );

/** A stored layout that does not describe this text is no layout. */
export function parseChapterLayout(value: unknown, textLength: number): ChapterLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.unit !== "paragraph" && input.unit !== "page") return null;
  if (!ascending(input.paragraphs, textLength) || !ascending(input.sentences, textLength)) return null;
  const paragraphs = input.paragraphs;
  const sentences = input.sentences;
  // Every block opens a sentence, so a sentence never spans two blocks.
  if (!paragraphs.every((start) => sentences[firstAtOrAfter(sentences, start)] === start)) return null;
  let headings: ChapterHeading[] | undefined;
  if (input.headings !== undefined) {
    if (!Array.isArray(input.headings)) return null;
    headings = [];
    for (const heading of input.headings) {
      if (!heading || typeof heading !== "object") return null;
      const { paragraph, level } = heading as Record<string, unknown>;
      if (
        typeof paragraph !== "number" ||
        !Number.isSafeInteger(paragraph) ||
        paragraph < 0 ||
        paragraph >= paragraphs.length ||
        typeof level !== "number" ||
        !Number.isSafeInteger(level) ||
        level < 1 ||
        level > 6
      )
        return null;
      headings.push({ paragraph, level });
    }
  }
  return { unit: input.unit, paragraphs, sentences, ...(headings?.length ? { headings } : {}) };
}

/** Index of the first sentence of a block in the sentence table. */
function firstSentence(layout: ChapterLayout, paragraph: number): number {
  return firstAtOrAfter(layout.sentences, layout.paragraphs[paragraph]!);
}

export function sentenceCount(layout: ChapterLayout, paragraph: number): number {
  if (paragraph < 0 || paragraph >= layout.paragraphs.length) return 0;
  const next = layout.paragraphs[paragraph + 1];
  return (next === undefined ? layout.sentences.length : firstAtOrAfter(layout.sentences, next)) - firstSentence(layout, paragraph);
}

/** The address of the sentence that holds a character offset. Offsets past the text land in the last sentence. */
export function addressAt(layout: ChapterLayout, offset: number): BookAddress {
  const at = Math.max(0, offset);
  const paragraph = Math.max(0, lastAtOrBefore(layout.paragraphs, at));
  const sentence = Math.max(0, lastAtOrBefore(layout.sentences, at) - firstSentence(layout, paragraph));
  return { paragraph, sentence };
}

/**
 * Start offset of an address. A block past the chapter is the chapter's end;
 * a sentence past its block is the start of the next block.
 */
export function offsetOf(layout: ChapterLayout, textLength: number, address: BookAddress): number {
  if (address.paragraph >= layout.paragraphs.length) return textLength;
  const paragraph = Math.max(0, address.paragraph);
  const blockEnd = layout.paragraphs[paragraph + 1] ?? textLength;
  if (address.sentence >= sentenceCount(layout, paragraph)) return blockEnd;
  return layout.sentences[firstSentence(layout, paragraph) + Math.max(0, address.sentence)]!;
}

/** End offset (exclusive) of the sentence that holds a character offset. */
export function sentenceEndAt(layout: ChapterLayout, textLength: number, offset: number): number {
  const index = Math.max(0, lastAtOrBefore(layout.sentences, Math.max(0, offset)));
  return layout.sentences[index + 1] ?? textLength;
}

/** The addresses a character range [start, end) starts and ends in. An empty range is the sentence at start. */
export function spanAt(layout: ChapterLayout, start: number, end: number): { start: BookAddress; end: BookAddress } {
  return { start: addressAt(layout, start), end: addressAt(layout, Math.max(start, end - 1)) };
}

/**
 * The part of [from, to) that fits a character budget, in whole sentences: it
 * starts at the sentence holding `from`, takes every following sentence that
 * starts before `to` while the budget lasts, and always takes at least one.
 * `next` is where the rest of the range begins, or null when it is finished.
 */
export function readWindow(
  layout: ChapterLayout,
  textLength: number,
  range: { from: number; to?: number; budget: number },
): { start: number; end: number; next: number | null } {
  const limit = Math.min(textLength, Math.max(0, range.to ?? textLength));
  const first = Math.max(0, lastAtOrBefore(layout.sentences, Math.max(0, range.from)));
  const start = layout.sentences[first] ?? 0;
  if (start >= limit) return { start, end: start, next: null };
  const lastInRange = lastAtOrBefore(layout.sentences, limit - 1);
  const reach = start + Math.max(1, range.budget);
  // The last sentence that ends within the budget: the one before the last boundary at or before `reach`.
  const lastInBudget = reach >= textLength ? layout.sentences.length - 1 : lastAtOrBefore(layout.sentences, reach) - 1;
  const last = Math.max(first, Math.min(lastInRange, lastInBudget));
  const end = layout.sentences[last + 1] ?? textLength;
  return { start, end, next: last < lastInRange ? end : null };
}

/** The blocks a character range [start, end) touches, with the slice of each that lies inside it. */
export function blocksIn(
  layout: ChapterLayout,
  start: number,
  end: number,
): { paragraph: number; start: number; end: number; level?: number }[] {
  if (end <= start) return [];
  const levels = new Map(layout.headings?.map((heading) => [heading.paragraph, heading.level]));
  const blocks: { paragraph: number; start: number; end: number; level?: number }[] = [];
  for (let paragraph = Math.max(0, lastAtOrBefore(layout.paragraphs, start)); paragraph < layout.paragraphs.length; paragraph++) {
    const blockStart = layout.paragraphs[paragraph]!;
    if (blockStart >= end) break;
    const level = levels.get(paragraph);
    blocks.push({
      paragraph,
      start: Math.max(start, blockStart),
      end: Math.min(end, layout.paragraphs[paragraph + 1] ?? end),
      ...(level === undefined ? {} : { level }),
    });
  }
  return blocks;
}
