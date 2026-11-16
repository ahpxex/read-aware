/**
 * The app's side of agent evals: the environment a real-book scenario runs in.
 *
 * A registered eval book is added to the headless shell as a file in the
 * library. From there on it is read by the app: `createBookTextPort` is the
 * port the desktop agent uses, over the same parse, extraction, search and
 * location code. The reader's page and selection of a turn are handed to the
 * runtime the way the reader reports them — as locations in the book, with the
 * viewport text the app's own sampler would send — so the runtime resolves
 * them through the real path instead of being told the answer.
 *
 * The business store is not behind this host yet: annotations, memory and
 * conversations stay on the agent package's in-memory ports.
 */
import { readFileSync } from "node:fs";
import {
  isRealBookId,
  realBookFile,
  realBookSlugs,
  realBookSnapshotFile,
  type RealBookSlug,
  type RealBookSnapshot,
} from "@read-aware/agent/evals/books";
import { createInMemoryEnvironment, type EvalEnvironment, type EvalHost } from "@read-aware/agent/evals/host";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import type { BookTextRange, ChapterLayout } from "@read-aware/core";
import { getExtractedChapters } from "../../src/domain/library";
import { createBookTextPort } from "../../src/features/ai/agent/ports/book-text-port";
import { fileContentVersion, withBookContent } from "../../src/features/library/lib/book-content-source";
import { rangesOfBookText } from "../../src/features/library/lib/book-text-store";
import { foliateAuthor, foliateTitle } from "../../src/features/reader/lib/foliate-engine";
import { normalizeReadingCursorText } from "../../src/features/reader/lib/reading-cursor";
import type { HeadlessShell } from "./shell";

export const APP_HEADLESS_ENVIRONMENT = "app-headless";

const bookIdOf = (slug: RealBookSlug) => `eval-${slug}`;

/** Put every registered eval book into the shell's library, as the file it is. */
export function addEvalBooks(shell: HeadlessShell, slugs: readonly RealBookSlug[] = realBookSlugs()): void {
  for (const slug of slugs)
    shell.addBook({
      id: bookIdOf(slug),
      title: slug,
      fileName: `${slug}.epub`,
      fileType: "application/epub+zip",
      bytes: new Uint8Array(readFileSync(realBookFile(slug))),
    });
}

/** A registered book as the app reads it now: what a scenario's fixture data must equal. */
export async function extractEvalBook(slug: RealBookSlug): Promise<RealBookSnapshot> {
  const bookId = bookIdOf(slug);
  const chapters = await getExtractedChapters(bookId, "system");
  const contentVersion = await fileContentVersion(bookId);
  const { title, author } = await withBookContent(bookId, contentVersion, undefined, async ({ book }) => ({
    title: foliateTitle(book),
    author: foliateAuthor(book),
  }));
  return {
    title,
    ...(author ? { author } : {}),
    contentVersion,
    chapters: chapters.map(snapshotChapter),
  };
}

/** What a snapshot keeps of an extracted chapter: its text and block table, not the platform's sentence table. */
export function snapshotChapter(chapter: {
  title?: string;
  text: string;
  hrefs?: string[];
  layout: ChapterLayout;
}): RealBookSnapshot["chapters"][number] {
  return {
    ...(chapter.title === undefined ? {} : { title: chapter.title }),
    text: chapter.text,
    ...(chapter.hrefs ? { hrefs: chapter.hrefs } : {}),
    unit: chapter.layout.unit,
    blocks: chapter.layout.paragraphs,
    ...(chapter.layout.headings ? { headings: chapter.layout.headings } : {}),
  };
}

export function readEvalBookSnapshot(slug: RealBookSlug): RealBookSnapshot | null {
  try {
    return JSON.parse(readFileSync(realBookSnapshotFile(slug), "utf8")) as RealBookSnapshot;
  } catch {
    // No snapshot written yet for this book.
    return null;
  }
}

/**
 * Where a stretch of a chapter's text is in the book, as the reader reports a
 * page or a selection: a location per source document, and the text itself.
 */
async function readerLocation(bookId: string, chapterIndex: number, quote: string) {
  const chapter = (await getExtractedChapters(bookId, "system"))[chapterIndex];
  const wanted = quote.replace(/\s+/g, " ").trim();
  const start = chapter && wanted ? chapter.text.indexOf(wanted) : -1;
  if (!chapter || start < 0)
    throw new Error(
      `The scenario's page is not in chapter ${chapterIndex} of ${bookId} as the app extracts it: ${JSON.stringify(wanted.slice(0, 60))}`,
    );
  const ranges = await rangesOfBookText(bookId, { chapterIndex, start, end: start + wanted.length });
  if (!ranges.length) throw new Error(`No reader location for chapter ${chapterIndex} of ${bookId}`);
  return { chapter, ranges, text: wanted };
}

export function createAppEvalHost(shell: HeadlessShell): EvalHost {
  return {
    id: APP_HEADLESS_ENVIRONMENT,
    createEnvironment: (scenario): EvalEnvironment => {
      const seeded = Object.keys(scenario.seed.chapters ?? {});
      const real = seeded.filter(isRealBookId);
      // A scenario about a few seeded lines of text has no book file to read: it stays on the seeded fixtures.
      if (!real.length) return createInMemoryEnvironment(scenario);
      if (real.length !== seeded.length)
        throw new Error(`Scenario ${scenario.id} mixes real books with seeded chapter text`);
      // The seed's chapter text is the snapshot of what the app extracts; the port reads the book itself.
      const context = createInMemoryDeps(scenario.seed);
      context.deps.bookText = createBookTextPort("agent");
      const reached = shell.unprovided.length;
      const { scope } = scenario;
      return {
        ...context,
        environment: APP_HEADLESS_ENVIRONMENT,
        // A native command the shell lacks failed some call of this scenario: the host's gap, not the agent's doing.
        faults: () => [...new Set(shell.unprovided.slice(reached))].map((command) => `native command "${command}"`),
        rangeOf: async (bookId, chapterIndex, text) => (await readerLocation(bookId, chapterIndex, text)).ranges[0]!,
        locateTurn: async (turn) => {
          if (scope.kind !== "book") return turn;
          const bookId = scope.bookId;
          const cursor = turn.readingCursor;
          const chapterIndex = cursor?.chapterIndex;
          const anchorOf = (range: BookTextRange) => range.cfi;
          const page =
            cursor && chapterIndex !== undefined && cursor.visibleText?.trim()
              ? await readerLocation(bookId, chapterIndex, cursor.visibleText)
              : undefined;
          const attachments = turn.attachments
            ? await Promise.all(
                turn.attachments.map(async (attachment) => {
                  if (chapterIndex === undefined || attachment.anchor) return attachment;
                  const selection = await readerLocation(bookId, chapterIndex, attachment.text);
                  return {
                    ...attachment,
                    anchor: anchorOf(selection.ranges[0]!),
                    chapter: attachment.chapter ?? selection.chapter.hrefs?.[0],
                  };
                }),
              )
            : undefined;
          if (!cursor) return { ...turn, ...(attachments ? { attachments } : {}) };
          // What the reader sends: where the page is, the chapter's href, and the sampled text —
          // not a chapter index and not offsets. The runtime works those out as it does in the app.
          const { chapterIndex: _index, position: _position, ...sampled } = cursor;
          const visibleText = page ? normalizeReadingCursorText(page.text) : undefined;
          return {
            ...turn,
            ...(attachments ? { attachments } : {}),
            readingCursor: {
              ...sampled,
              ...(page
                ? {
                    anchor: anchorOf(page.ranges[0]!),
                    ...(page.ranges.length > 1 ? { viewportAnchors: page.ranges.map(anchorOf) } : {}),
                    chapter: sampled.chapter ?? page.chapter.hrefs?.[0],
                  }
                : { chapterIndex }),
              ...(visibleText ? { visibleText } : {}),
            },
          };
        },
      };
    },
  };
}
