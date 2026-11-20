/**
 * Smart selection: move the edges of a hand-made selection onto the sentence,
 * clause and word boundaries the reader evidently meant.
 *
 * A drag rarely lands exactly: it misses a sentence's first character or its
 * closing punctuation, or runs a character into the next sentence. Each edge
 * moves to the nearest boundary when the gap is at most a couple of
 * characters (or one word in a spaced script). A selection that is clearly a
 * phrase in the middle of a sentence stays as it is, because its edges are
 * far from any boundary.
 *
 * Sentence boundaries come from `buildChapterLayout`, the same segmentation
 * the reading addresses use, so a snapped mark ends where those sentences end.
 * This module works on plain text; `selection-snap-range.ts` maps a DOM Range
 * to and from it.
 */
import { buildChapterLayout } from "@read-aware/core";

export type SelectionSnapInput = {
  /** The text around the selection: whole blocks from the one the selection starts in to the one it ends in. */
  text: string;
  /** Start offset of each block in `text`, ascending. */
  blocks: readonly number[];
  start: number;
  end: number;
  /** BCP 47 tag of the text's language, for sentence segmentation. */
  locale?: string;
  /** `words` only trims and completes cut words, for text whose sentence structure is unreliable (a PDF text layer). */
  mode?: "text" | "words";
  /** The text just before `start` is out of view: the selection began at the edge of the visible page. */
  continuesBefore?: boolean;
  /** The text just after `end` is out of view: the selection ran to the edge of the visible page. */
  continuesAfter?: boolean;
};

export type SelectionSnapResult = { start: number; end: number };

/** An edge moves to a boundary at most this many units away (two CJK characters, or one word). */
const EDGE_TOLERANCE = 2;
/** Smaller selections are taken as deliberate words or phrases; only trimming and word completion apply. */
const MIN_SNAP_UNITS = 4;
/** A selection running off the page extends to the end of its paragraph only within this many characters. */
const MAX_BLOCK_EXTENSION = 4000;

const IGNORABLE = /[\s­​-‍⁠﻿]/u;
/** Scripts written without spaces between words: each character counts as one unit. */
const DENSE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}々〆ー]/u;
const WORD = /[\p{L}\p{M}\p{N}]/u;
const APOSTROPHE = /['’]/u;
/** Marks that end a clause inside a sentence. ASCII ones only count when followed by a space. */
const CLAUSE = /[，、；：—–―…‥,;:]/u;
const ASCII_CLAUSE = /[,;:]/u;
const CLOSER = /[”’」』）)\]】》〉"'»›〕〗〙〛]/u;
/** Unambiguous opening marks. The Unicode sentence rules attach these to the end of the sentence before. */
const OPENER = /[“‘「『（([【《〈«‹〔〖〘〚]/u;

const isSpacedWordChar = (char: string) => WORD.test(char) && !DENSE.test(char);

/** The code point ending at `offset`, or "" at the start. */
function charBefore(text: string, offset: number): string {
  if (offset <= 0) return "";
  const low = text.charCodeAt(offset - 1);
  if (low >= 0xdc00 && low <= 0xdfff && offset >= 2) {
    const high = text.charCodeAt(offset - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(offset - 2, offset);
  }
  return text[offset - 1]!;
}

/** The code point starting at `offset`, or "" at the end. */
function charAt(text: string, offset: number): string {
  if (offset >= text.length) return "";
  return String.fromCodePoint(text.codePointAt(offset)!);
}

/**
 * How much reading `text` holds: one unit per character of a dense script,
 * two per word of a spaced script, none for punctuation and spaces. A gap of
 * EDGE_TOLERANCE units is two characters or one word.
 */
export function readingUnits(text: string): number {
  let units = 0;
  let inWord = false;
  let previous = "";
  for (const char of text) {
    if (DENSE.test(char)) {
      units++;
      inWord = false;
    } else if (WORD.test(char)) {
      if (!inWord) units += 2;
      inWord = true;
    } else if (!(inWord && APOSTROPHE.test(char) && WORD.test(previous))) {
      inWord = false;
    }
    previous = char;
  }
  return units;
}

/** Extend an edge that cuts through a word of a spaced script to the whole word. */
function completeWordStart(text: string, start: number): number {
  if (!isSpacedWordChar(charAt(text, start))) return start;
  let at = start;
  for (;;) {
    const before = charBefore(text, at);
    if (isSpacedWordChar(before)) at -= before.length;
    else if (APOSTROPHE.test(before) && isSpacedWordChar(charBefore(text, at - before.length))) at -= before.length;
    else return at;
  }
}

function completeWordEnd(text: string, end: number): number {
  if (!isSpacedWordChar(charBefore(text, end))) return end;
  let at = end;
  for (;;) {
    const next = charAt(text, at);
    if (isSpacedWordChar(next)) at += next.length;
    else if (APOSTROPHE.test(next) && isSpacedWordChar(charAt(text, at + next.length))) at += next.length;
    else return at;
  }
}

type Span = { lo: number; hi: number };

/** `[from, to)` without ignorable characters at either end; empty when nothing else is in it. */
function contentOf(text: string, from: number, to: number): Span {
  let lo = from;
  let hi = to;
  while (lo < hi && IGNORABLE.test(text[lo]!)) lo++;
  while (hi > lo && IGNORABLE.test(text[hi - 1]!)) hi--;
  return { lo, hi };
}

/** Index of the last span whose `lo` is <= offset, or 0. */
function spanAt(spans: readonly Span[], offset: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle]!.lo <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

type Boundaries = {
  sentences: Span[];
  blocks: Span[];
  /** Where a selection may begin: sentence starts and clause starts, ascending. */
  startStops: number[];
  /** Where a selection may end: sentence ends (closing punctuation included) and clause ends, ascending. */
  endStops: number[];
  /** The stops that are sentence boundaries; the rest are clause boundaries. */
  sentenceStops: Set<number>;
};

/**
 * Straight double quotes that open a quotation. A straight quote is both
 * opener and closer, so within a block they pair up in order: the first
 * opens, the second closes, and so on.
 */
function openingStraightQuotes(text: string, blockStarts: readonly number[]): Set<number> {
  const opening = new Set<number>();
  blockStarts.forEach((from, index) => {
    const to = blockStarts[index + 1] ?? text.length;
    let open = false;
    for (let at = text.indexOf('"', from); at !== -1 && at < to; at = text.indexOf('"', at + 1)) {
      open = !open;
      if (open) opening.add(at);
    }
  });
  return opening;
}

function boundaries(text: string, blockStarts: readonly number[], locale: string | undefined): Boundaries {
  const layout = buildChapterLayout(text, blockStarts, { locale });
  const blockStartSet = new Set(layout.paragraphs);
  const straightOpeners = openingStraightQuotes(text, layout.paragraphs);
  const opens = (at: number) => OPENER.test(text[at]!) || straightOpeners.has(at);
  // `他点头。“走吧。”` segments as `他点头。“` + `走吧。”`: give the opening quote back to its sentence.
  const sentenceStarts = layout.sentences.map((from, index) => {
    if (blockStartSet.has(from)) return from;
    const previous = layout.sentences[index - 1] ?? 0;
    let at = from;
    while (at > previous + 1 && IGNORABLE.test(text[at - 1]!)) at--;
    let opened = at;
    while (opened > previous + 1 && opens(opened - 1)) opened--;
    return opened < at ? opened : from;
  });
  const sentences: Span[] = [];
  const startStops = new Set<number>();
  const endStops = new Set<number>();
  const sentenceStops = new Set<number>();
  sentenceStarts.forEach((from, index) => {
    const span = contentOf(text, from, sentenceStarts[index + 1] ?? text.length);
    if (span.lo >= span.hi) return;
    sentences.push(span);
    startStops.add(span.lo);
    endStops.add(span.hi);
    sentenceStops.add(span.lo).add(span.hi);
    for (let at = span.lo; at < span.hi; at++) {
      if (!CLAUSE.test(text[at]!)) continue;
      let after = at;
      while (after < span.hi && CLAUSE.test(text[after]!)) after++;
      const run = { from: at, to: after };
      at = after - 1;
      if (ASCII_CLAUSE.test(text[run.to - 1]!) && !IGNORABLE.test(text[run.to] ?? "")) continue;
      // Punctuation that only closing marks follow is how the sentence ends, not a clause boundary.
      let tail = run.to;
      while (tail < span.hi && !opens(tail) && (CLOSER.test(text[tail]!) || IGNORABLE.test(text[tail]!))) tail++;
      if (tail >= span.hi) continue;
      if (run.from > span.lo) endStops.add(run.from);
      startStops.add(contentOf(text, run.to, span.hi).lo);
    }
  });
  const blocks = layout.paragraphs
    .map((from, index) => contentOf(text, from, layout.paragraphs[index + 1] ?? text.length))
    .filter((span) => span.lo < span.hi);
  const ascending = (a: number, b: number) => a - b;
  return {
    sentences,
    blocks,
    startStops: [...startStops].sort(ascending),
    endStops: [...endStops].sort(ascending),
    sentenceStops,
  };
}

const lastBelow = (stops: readonly number[], value: number) => {
  let found: number | undefined;
  for (const stop of stops) {
    if (stop >= value) break;
    found = stop;
  }
  return found;
};
const firstAbove = (stops: readonly number[], value: number) => stops.find((stop) => stop > value);

type Candidate = { to: number; gap: string; sentence: boolean };

/**
 * Choose between moving an edge outward (the reader stopped short) and inward
 * (the reader overshot into the neighbouring sentence or clause). Both must be
 * within tolerance; an inward move must leave clearly more than it drops. The
 * smaller gap wins; at a tie a sentence boundary beats a clause boundary, and
 * then outward beats inward, since it keeps everything the reader selected.
 */
function nearest(outward: Candidate | null, inward: (Candidate & { kept: string }) | null): number | null {
  const outwardCost = outward ? readingUnits(outward.gap) : Number.POSITIVE_INFINITY;
  let inwardCost = inward ? readingUnits(inward.gap) : Number.POSITIVE_INFINITY;
  if (inward && inwardCost <= EDGE_TOLERANCE) {
    const kept = readingUnits(inward.kept);
    if (kept === 0 || kept < 2 * inwardCost) inwardCost = Number.POSITIVE_INFINITY;
  }
  const outwardOk = outward !== null && outwardCost <= EDGE_TOLERANCE;
  const inwardOk = inward !== null && inwardCost <= EDGE_TOLERANCE;
  if (outwardOk && inwardOk) {
    if (outwardCost !== inwardCost) return outwardCost < inwardCost ? outward.to : inward.to;
    return inward.sentence && !outward.sentence ? inward.to : outward.to;
  }
  if (outwardOk) return outward.to;
  if (inwardOk) return inward.to;
  return null;
}

/** Snapped offsets for a selection, or null when its edges should stay where they are. */
export function snapSelection(input: SelectionSnapInput): SelectionSnapResult | null {
  const { text } = input;
  if (!(input.start >= 0 && input.end <= text.length && input.start < input.end)) return null;
  let { lo: start, hi: end } = contentOf(text, input.start, input.end);
  if (start >= end) return null;
  start = completeWordStart(text, start);
  end = completeWordEnd(text, end);

  if (input.mode !== "words" && readingUnits(text.slice(start, end)) >= MIN_SNAP_UNITS) {
    const found = boundaries(text, input.blocks, input.locale);
    if (found.sentences.length > 0) ({ start, end } = snapToBoundaries(text, found, start, end, input));
  }

  return start === input.start && end === input.end ? null : { start, end };
}

function snapToBoundaries(
  text: string,
  { sentences, blocks, startStops, endStops, sentenceStops }: Boundaries,
  selectionStart: number,
  selectionEnd: number,
  input: SelectionSnapInput,
): SelectionSnapResult {
  let start = selectionStart;
  let end = selectionEnd;

  // 1. Edges a character or two away from a sentence or clause boundary.
  //    An edge separated from its sentence's start or end only by punctuation
  //    is left to step 3, which checks that the selection is sentence-shaped.
  {
    const sentence = sentences[spanAt(sentences, start)]!;
    if (start > sentence.lo && readingUnits(text.slice(sentence.lo, start)) > 0) {
      const before = lastBelow(startStops, start);
      const after = firstAbove(startStops, start);
      const snapped = nearest(
        before === undefined
          ? null
          : { to: before, gap: text.slice(before, start), sentence: sentenceStops.has(before) },
        after === undefined || after >= end
          ? null
          : {
              to: after,
              gap: text.slice(start, after),
              sentence: sentenceStops.has(after),
              kept: text.slice(after, end),
            },
      );
      if (snapped !== null) start = snapped;
    }
  }
  {
    const sentence = sentences[spanAt(sentences, end - 1)]!;
    if (end < sentence.hi && readingUnits(text.slice(end, sentence.hi)) > 0) {
      const after = firstAbove(endStops, end);
      const before = lastBelow(endStops, end);
      const snapped = nearest(
        after === undefined ? null : { to: after, gap: text.slice(end, after), sentence: sentenceStops.has(after) },
        before === undefined || before <= start
          ? null
          : {
              to: before,
              gap: text.slice(before, end),
              sentence: sentenceStops.has(before),
              kept: text.slice(start, before),
            },
      );
      if (snapped !== null) end = snapped;
    }
  }

  // 2. A selection that runs to the edge of the visible page continues to
  //    the end of its sentence there, and to the end of its paragraph when it
  //    began with that paragraph. An edge step 1 pulled back stays back.
  if (input.continuesAfter && end >= selectionEnd) {
    const sentence = sentences[spanAt(sentences, end - 1)]!;
    if (end < sentence.hi) end = sentence.hi;
    const block = blocks[spanAt(blocks, end - 1)];
    const startBlock = blocks[spanAt(blocks, start)];
    if (block && startBlock && start <= startBlock.lo && end < block.hi && block.hi - start <= MAX_BLOCK_EXTENSION)
      end = block.hi;
  }
  if (input.continuesBefore && start <= selectionStart) {
    const sentence = sentences[spanAt(sentences, start)]!;
    if (start > sentence.lo) start = sentence.lo;
    const block = blocks[spanAt(blocks, start)];
    const endBlock = blocks[spanAt(blocks, end - 1)];
    if (block && endBlock && end >= endBlock.hi && start > block.lo && end - block.lo <= MAX_BLOCK_EXTENSION)
      start = block.lo;
  }

  // 3. Punctuation: a selection shaped like whole sentences or clauses takes
  //    its sentence's closing punctuation and closing quote, and its opening
  //    quote or bracket. A phrase from mid-sentence does not. An edge short of
  //    its sentence only by punctuation counts as at the sentence, so a quoted
  //    sentence missing both quotes takes both.
  const first = sentences[spanAt(sentences, start)]!;
  const last = sentences[spanAt(sentences, end - 1)]!;
  const punctuationBefore = start > first.lo && readingUnits(text.slice(first.lo, start)) === 0;
  const punctuationAfter = end < last.hi && readingUnits(text.slice(end, last.hi)) === 0;
  const spansSentences = sentences.some((sentence) => sentence.lo > start && sentence.lo < end);
  const startsWhole = startStops.includes(start) || punctuationBefore || spansSentences;
  const endsWhole = endStops.includes(end) || punctuationAfter || spansSentences;
  if (punctuationAfter && startsWhole) end = last.hi;
  if (punctuationBefore && endsWhole) start = first.lo;

  return { start, end };
}
