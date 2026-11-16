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
  type BookTextLocation,
  type ChapterLayout,
  type Id,
} from "@read-aware/core";
import type { BookTextPort, ChapterRef, TurnAttachment } from "../ports";
import type { ChapterRange, LocatedRange, TurnReadingPosition } from "./reading-cursor";

export { describeSpan } from "./reading-cursor";
export type { ChapterRange, LocatedRange, TurnReadingPosition } from "./reading-cursor";

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
  /** The part of a reading cursor that says where the viewport is. */
  cursor?: { anchor?: string; chapterIndex?: number; position?: { start: number; end: number } };
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
