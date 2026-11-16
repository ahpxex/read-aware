import { buildChapterLayout, type ChapterLayout } from "@read-aware/core";
import type { ChapterRange } from "../runtime/reading-position";

const layouts = new Map<string, ChapterLayout>();

/**
 * The layout of fixture chapter text, whose line breaks are its paragraph
 * breaks. A real host reads the blocks from the book's markup; a fixture has
 * only the text.
 */
export function plainTextLayout(text: string): ChapterLayout {
  let layout = layouts.get(text);
  if (!layout) {
    const starts: number[] = [];
    for (const match of text.matchAll(/\n\s*/g)) starts.push(match.index + match[0].length);
    layout = buildChapterLayout(text, starts);
    layouts.set(text, layout);
  }
  return layout;
}

/**
 * The reader's page as a range of a fixture chapter: the place where `visible`
 * occurs in its text. This is how a test or an eval states "the reader is here"
 * without a rendering engine; a real host resolves the reader's location.
 */
export function chapterRangeOf(
  chapters: readonly { text: string }[],
  chapterIndex: number,
  visible: string,
): ChapterRange {
  const text = chapters[chapterIndex]?.text;
  if (text === undefined) throw new Error(`fixture has no chapter ${chapterIndex}`);
  const start = text.indexOf(visible);
  if (start < 0) throw new Error(`fixture chapter ${chapterIndex} does not contain the given page text`);
  return { chapterIndex, start, end: start + visible.length };
}
