/**
 * Matching for the contents panel's search: chapters (by title, by printed
 * chapter number, or by position in the contents), bookmarks and the
 * reader's marks. Full-text hits come from the library's location search
 * (see useContentsSearch). Ported from the retired Jumper plugin's go-to box,
 * so a query that found a chapter there finds the same one here.
 */
import type { Bookmark, BookLocationHit, BookTocEntry } from "@read-aware/core";
import type { Annotation } from "../../annotations";
import type { TocEntry } from "./reader-types";

/** Unicode-normalized, case-folded text for substring matching. */
export function foldForSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase();
}

export function matchesQuery(text: string | null | undefined, query: string): boolean {
  const needle = foldForSearch(query.trim());
  return !!needle && !!text && foldForSearch(text).includes(needle);
}

const CJK_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CJK_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 萬: 10000 };

/** A positive chapter number written in Arabic or Chinese numerals, else null. */
export function chapterNumber(value: string): number | null {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  if (!/^[零〇一二两兩三四五六七八九十百千万萬]+$/u.test(normalized)) return null;
  // The pattern above admits only BMP CJK numerals, one code unit each.
  const chars = normalized.split("");
  // Positional digits ("一二" = 12) when no unit character is used.
  if (chars.every((char) => char in CJK_DIGITS)) {
    const number = Number(chars.map((char) => CJK_DIGITS[char]).join(""));
    return number > 0 && Number.isSafeInteger(number) ? number : null;
  }
  let total = 0,
    section = 0,
    digit = 0;
  for (const char of chars) {
    if (char in CJK_DIGITS) digit = CJK_DIGITS[char]!;
    else if (CJK_UNITS[char] === 10000) {
      total += (section + digit || 1) * 10000;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * CJK_UNITS[char]!;
      digit = 0;
    }
  }
  return total + section + digit || null;
}

/** The chapter number a contents label prints ("第十二章", "Chapter 12", "12. Title"). */
export function printedChapterNumber(label: string): number | null {
  const text = label.normalize("NFKC").trim();
  const match =
    text.match(/^第\s*([\d零〇一二两兩三四五六七八九十百千万萬]+)\s*[章节節回卷部篇]/u) ??
    text.match(/^(?:chapter|chapitre|kapitel|capítulo|глава)\s+(\d+)\b/iu) ??
    text.match(/^(\d+)(?:[.)、:\s]|$)/u);
  return match ? chapterNumber(match[1]!) : null;
}

/**
 * Chapters for a query, as indices into `entries`: a chapter number matches
 * the chapters printed with that number, falling back to the Nth contents
 * entry when none is; anything else matches titles.
 */
export function matchChapters(entries: readonly TocEntry[], query: string): number[] {
  const number = chapterNumber(query);
  const indices = entries.map((_, index) => index);
  if (number !== null) {
    const printed = indices.filter((index) => printedChapterNumber(entries[index]!.label) === number);
    if (printed.length) return printed;
    const titled = indices.filter((index) => matchesQuery(entries[index]!.label, query));
    if (titled.length) return titled;
    return number <= entries.length ? [number - 1] : [];
  }
  return indices.filter((index) => matchesQuery(entries[index]!.label, query));
}

export function matchBookmarks(bookmarks: readonly Bookmark[], query: string): Bookmark[] {
  return bookmarks.filter((bookmark) => matchesQuery(bookmark.name, query));
}

/** Highlights and notes whose passage or note text matches; questions asked
 * of the agent are not the reader's marks. */
export function matchAnnotations(annotations: readonly Annotation[], query: string): Annotation[] {
  return annotations.filter(
    (annotation) =>
      annotation.type !== "ask" &&
      (matchesQuery(annotation.text, query) || (annotation.type === "note" && matchesQuery(annotation.content, query))),
  );
}

/** Printed page labels are short tokens ("42", "xiv", "A-3"). */
export function isPageLabelQuery(query: string): boolean {
  return /^\S{1,16}$/u.test(query.trim());
}

/** Capitals in the query ask for an exact-case text match. */
export function wantsMatchCase(query: string): boolean {
  return /\p{Lu}/u.test(query);
}

/** A line of the book for comparing with a chapter's title: spacing and case
 *  differ freely between a contents label and the heading it names
 *  ("第二章 台 球" / "第二章 台球"). */
const lineKey = (text: string) => foldForSearch(text).replace(/\s+/gu, "");

/**
 * Tells the text hits that only repeat a listed chapter: a hit on a line that
 * is, whole, the title of one of `chapterTitles` — that chapter's own heading,
 * or its line on a contents page. The results list the chapter itself, so
 * such a line is not counted again as the book's text. A title's words inside
 * a longer line are still a text hit.
 */
export function chapterTitleHits(chapterTitles: readonly string[]): (hit: BookLocationHit) => boolean {
  const keys = new Set(chapterTitles.map(lineKey).filter(Boolean));
  return (hit) => !!hit.blockText && keys.has(lineKey(hit.blockText));
}

/**
 * The chapter a book section belongs to, from the navigation TOC: the first
 * contents entry that starts in that section, else the last entry before it
 * (a section between chapters, or a chapter split across files).
 */
export function sectionChapterLabels(entries: readonly BookTocEntry[]): (sectionIndex: number) => string | undefined {
  const first = new Map<number, string>();
  const last = new Map<number, string>();
  const walk = (list: readonly BookTocEntry[]) => {
    for (const entry of list) {
      const label = entry.label.trim();
      if (entry.sectionIndex !== null && label) {
        if (!first.has(entry.sectionIndex)) first.set(entry.sectionIndex, label);
        last.set(entry.sectionIndex, label);
      }
      walk(entry.children);
    }
  };
  walk(entries);
  const starts = [...last.keys()].sort((a, b) => a - b);
  return (sectionIndex) => {
    const exact = first.get(sectionIndex);
    if (exact) return exact;
    let before: number | undefined;
    for (const start of starts) {
      if (start > sectionIndex) break;
      before = start;
    }
    return before === undefined ? undefined : last.get(before);
  };
}

/** Consecutive text hits in one chapter, in reading order. */
export type ChapterHits = { chapter: string | undefined; hits: BookLocationHit[] };

/**
 * Text hits under the chapter each is in. Hits arrive in reading order, so a
 * chapter's hits are one run; a hit whose section has no chapter (before the
 * first contents entry, or before the contents are read) starts a run without
 * a name.
 */
export function groupHitsByChapter(
  hits: readonly BookLocationHit[],
  chapterOf: ((sectionIndex: number) => string | undefined) | undefined,
): ChapterHits[] {
  const groups: ChapterHits[] = [];
  for (const hit of hits) {
    const chapter = chapterOf?.(hit.sectionIndex);
    const last = groups.at(-1);
    if (last && last.chapter === chapter) last.hits.push(hit);
    else groups.push({ chapter, hits: [hit] });
  }
  return groups;
}
