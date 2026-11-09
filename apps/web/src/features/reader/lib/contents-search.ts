/**
 * Matching for the contents panel's search: chapters (by title, by printed
 * chapter number, or by position in the contents), bookmarks and the
 * reader's marks. Full-text hits come from the library's location search
 * (see useContentsSearch). Ported from the retired Jumper plugin's go-to box,
 * so a query that found a chapter there finds the same one here.
 */
import type { Bookmark } from "@read-aware/core";
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
