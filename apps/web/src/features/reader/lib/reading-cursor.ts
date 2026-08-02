import { findTocIndexForHref } from "./epub-utils";
import type { TocEntry } from "./reader-types";

export const MAX_READING_CURSOR_TEXT_CHARS = 1_800;

const clampFraction = (value: number) => Math.max(0, Math.min(1, value));

/** A bounded, whitespace-normalized copy of the text visible in the viewport. */
export function normalizeReadingCursorText(
  value: string,
  maxChars = MAX_READING_CURSOR_TEXT_CHARS,
): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (maxChars <= 0) return undefined;
  if (text.length <= maxChars) return text;
  const separator = " … ";
  if (maxChars <= separator.length) return text.slice(0, maxChars);
  const available = Math.max(0, maxChars - separator.length);
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${text.slice(0, head)}${separator}${tail > 0 ? text.slice(-tail) : ""}`;
}

/**
 * Estimate progress through the active TOC entry on the same size-weighted
 * fraction scale as foliate. Duplicate ticks are skipped because several TOC
 * headings can resolve to the same document boundary.
 */
export function chapterProgressAt(
  entries: TocEntry[],
  chapterHref: string | null,
  bookProgress: number,
): number | undefined {
  const index = findTocIndexForHref(entries, chapterHref);
  if (index < 0) return undefined;
  const start = entries[index]?.fraction;
  if (start === undefined) return undefined;
  const end = entries
    .slice(index + 1)
    .map((entry) => entry.fraction)
    .find((fraction): fraction is number => fraction !== undefined && fraction > start);
  const boundary = end ?? 1;
  if (boundary <= start) return undefined;
  return clampFraction((bookProgress - start) / (boundary - start));
}
