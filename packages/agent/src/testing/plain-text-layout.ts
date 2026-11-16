import { buildChapterLayout, type ChapterLayout } from "@read-aware/core";
import type { ChapterRange } from "../runtime/reading-position";
import { findChapterByHref } from "../text/chapter-lookup";

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

/**
 * A turn as a fixture host sends it: the reader's page (`visibleText`) and the
 * selected passages are placed in the fixture chapter's text, the way a real
 * host places the reader's location in the book. Text the chapter does not
 * contain stays unplaced, and that turn runs without coordinates.
 */
export function locateFixtureTurn<
  Turn extends {
    readingCursor?: {
      chapter?: string;
      chapterIndex?: number;
      visibleText?: string;
      position?: { start: number; end: number };
    };
    attachments?: { text: string; position?: ChapterRange }[];
  },
>(turn: Turn, chapters: readonly { text: string; hrefs?: readonly string[] }[] | undefined): Turn {
  // A cursor that names its chapter by href is resolved the way the runtime resolves it.
  const href = turn.readingCursor?.chapter;
  const chapterIndex =
    turn.readingCursor?.chapterIndex ??
    (href === undefined || !chapters
      ? undefined
      : findChapterByHref(
          chapters.map((chapter, index) => ({ index, hrefs: chapter.hrefs })),
          href,
        )?.index);
  const text = chapterIndex === undefined ? undefined : chapters?.[chapterIndex]?.text;
  if (chapterIndex === undefined || text === undefined) return turn;
  const place = (quote: string | undefined) => {
    const exact = quote?.trim();
    const start = exact ? text.indexOf(exact) : -1;
    return start < 0 ? undefined : { start, end: start + exact!.length };
  };
  const cursor = turn.readingCursor!;
  const page = cursor.position ?? place(cursor.visibleText);
  return {
    ...turn,
    readingCursor: page ? { ...cursor, chapterIndex, position: page } : cursor,
    ...(turn.attachments
      ? {
          attachments: turn.attachments.map((attachment) => {
            const range = attachment.position ?? place(attachment.text);
            return range && !attachment.position
              ? { ...attachment, position: { chapterIndex, ...range } }
              : attachment;
          }),
        }
      : {}),
  };
}
