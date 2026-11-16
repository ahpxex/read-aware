/**
 * Where the reader is, in reading coordinates.
 *
 * The host samples a viewport and a selection as engine locations (CFIs). At
 * the start of a turn they are resolved once into offsets in the extracted
 * chapter text, and from there into chapter → block → sentence addresses: the
 * same coordinates read_chapter takes. The model receives the addresses, not
 * the text; it reads what it needs with the tool.
 *
 * Resolution is best-effort. A book whose text is not extracted, a location the
 * current content cannot place, or a host without the capability leaves the
 * turn without coordinates, never without an answer.
 */
import {
  buildChapterLayout,
  sentenceEndAt,
  spanAt,
  type BookAddress,
  type BookTextLocation,
  type ChapterLayout,
  type Id,
} from "@read-aware/core";
import type { BookTextPort, ChapterRef, TurnAttachment } from "../ports";
import type { ReadingCursor } from "./reading-cursor";

/** A character range of one chapter's extracted text. */
export type ChapterRange = { chapterIndex: number; start: number; end: number };

/** A range of one chapter with the addresses it starts and ends in. */
export type LocatedRange = ChapterRange & {
  span: { start: BookAddress; end: BookAddress };
  unit: ChapterLayout["unit"];
  /** Blocks in the chapter. */
  blocks: number;
  chapterTitle?: string;
};

export interface TurnReadingPosition {
  /** The viewport: what the reader's page shows. */
  viewport?: LocatedRange & {
    /** End (exclusive) of the last sentence the viewport shows any of: the reader's furthest text in this chapter. */
    through: number;
  };
  /** One entry per attachment, in order; undefined where a selection could not be placed. */
  selections: (LocatedRange | undefined)[];
}

type Source = Pick<BookTextPort, "getToc" | "getChapterText" | "getChapterLayout" | "locate">;

/** A chapter's layout, or one block of sentences for a host that keeps none. */
export async function chapterLayout(
  bookText: Pick<BookTextPort, "getChapterLayout">,
  bookId: Id,
  chapterIndex: number,
  text: string,
): Promise<ChapterLayout> {
  return (await bookText.getChapterLayout?.(bookId, chapterIndex)) ?? buildChapterLayout(text, []);
}

export async function resolveReadingPosition(input: {
  bookText: Source;
  bookId: Id;
  cursor?: ReadingCursor;
  attachments?: (TurnAttachment & { position?: ChapterRange })[];
  signal?: AbortSignal;
}): Promise<TurnReadingPosition> {
  const { bookText, bookId, cursor, signal } = input;
  let toc: ChapterRef[] | undefined;
  const chapters = new Map<number, Promise<{ layout: ChapterLayout; length: number; title?: string } | undefined>>();
  const chapter = (index: number) => {
    let loaded = chapters.get(index);
    if (!loaded) {
      loaded = (async () => {
        toc ??= await bookText.getToc(bookId);
        const text = await bookText.getChapterText(bookId, index);
        if (text === undefined) return undefined;
        return {
          layout: await chapterLayout(bookText, bookId, index, text),
          length: text.length,
          title: toc.find((entry) => entry.index === index)?.title,
        };
      })();
      chapters.set(index, loaded);
    }
    return loaded;
  };
  const describe = async (range: ChapterRange): Promise<LocatedRange | undefined> => {
    const found = await chapter(range.chapterIndex);
    if (!found) return undefined;
    const start = Math.max(0, Math.min(found.length, range.start));
    const end = Math.max(start, Math.min(found.length, range.end));
    return {
      chapterIndex: range.chapterIndex,
      start,
      end,
      span: spanAt(found.layout, start, end),
      unit: found.layout.unit,
      blocks: found.layout.paragraphs.length,
      ...(found.title ? { chapterTitle: found.title } : {}),
    };
  };
  const locate = async (cfi: string | undefined, quote?: string): Promise<BookTextLocation | undefined> => {
    if (!cfi || !bookText.locate) return undefined;
    return (
      (await bookText.locate(bookId, { cfi, ...(quote?.trim() ? { textQuote: { exact: quote } } : {}) }, signal)) ??
      undefined
    );
  };

  // The viewport belongs to the chapter it ends in: a page that shows the end
  // of one chapter and the start of the next has reached the next.
  let viewportRange: ChapterRange | undefined;
  if (cursor?.position && cursor.chapterIndex !== undefined)
    viewportRange = { chapterIndex: cursor.chapterIndex, ...cursor.position };
  else {
    const located = await locate(cursor?.anchor);
    if (located)
      viewportRange = {
        chapterIndex: located.end.chapterIndex,
        start: located.start.chapterIndex === located.end.chapterIndex ? located.start.offset : 0,
        end: located.end.offset,
      };
  }
  const viewport = viewportRange ? await describe(viewportRange) : undefined;
  const viewportChapter = viewport ? await chapter(viewport.chapterIndex) : undefined;

  // A selection belongs to the chapter it starts in.
  const selections = await Promise.all(
    (input.attachments ?? []).map(async (attachment) => {
      if (attachment.position) return describe(attachment.position);
      const located = await locate(attachment.anchor, attachment.text);
      if (!located) return undefined;
      const sameChapter = located.end.chapterIndex === located.start.chapterIndex;
      return describe({
        chapterIndex: located.start.chapterIndex,
        start: located.start.offset,
        end: sameChapter ? located.end.offset : Number.MAX_SAFE_INTEGER,
      });
    }),
  );

  return {
    ...(viewport && viewportChapter
      ? {
          viewport: {
            ...viewport,
            through: sentenceEndAt(
              viewportChapter.layout,
              viewportChapter.length,
              Math.max(viewport.start, viewport.end - 1),
            ),
          },
        }
      : {}),
    selections,
  };
}

/** "paragraph 12 sentence 0" in the unit of the chapter. */
const address = (unit: ChapterLayout["unit"], at: BookAddress) => `${unit} ${at.paragraph} sentence ${at.sentence}`;

/** One line of coordinates: a single sentence, or a start through an end. */
export function describeSpan(range: Pick<LocatedRange, "span" | "unit">): string {
  const { start, end } = range.span;
  return start.paragraph === end.paragraph && start.sentence === end.sentence
    ? address(range.unit, start)
    : `${address(range.unit, start)} through ${address(range.unit, end)}`;
}
