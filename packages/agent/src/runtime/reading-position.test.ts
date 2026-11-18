import { expect, test } from "bun:test";
import type { BookTextLocation, Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { chapterRangeOf } from "../testing/plain-text-layout";
import { describeSpan, resolveReadingPosition } from "./reading-position";

const CHAPTERS = [
  { title: "一", text: "第一章\n开头一句。收尾一句。" },
  { title: "二", text: "第二章\n爷从新街走出来。他回了学校。\n终也舀不干。竟是越来越旺。\n庄人都散了。" },
];
const bookId = "book" as Id;
function source(locate?: (cfi: string, quote?: string) => BookTextLocation | null) {
  const { deps } = createInMemoryDeps({ chapters: { book: CHAPTERS } });
  if (locate) deps.bookText.locate = async (_book, target) => locate(target.cfi, target.textQuote?.exact);
  return deps.bookText;
}
const at = (chapterIndex: number, quote: string) => {
  const { start, end } = chapterRangeOf(CHAPTERS, chapterIndex, quote);
  return { start: { chapterIndex, offset: start }, end: { chapterIndex, offset: end } };
};

test("a host location becomes the chapter addresses read_chapter takes", async () => {
  const page = "他回了学校。\n终也舀不干。";
  const located = await resolveReadingPosition({
    bookText: source((cfi) => (cfi === "page" ? at(1, page) : at(1, "竟是越来越旺"))),
    bookId,
    cursor: { anchor: "page", chapterIndex: 0 },
    attachments: [{ text: "竟是越来越旺", anchor: "selection" }],
  });
  expect(located.viewport).toMatchObject({
    chapterIndex: 1,
    chapterTitle: "二",
    unit: "paragraph",
    blocks: 4,
    span: { start: { paragraph: 1, sentence: 1 }, end: { paragraph: 2, sentence: 0 } },
  });
  // The reader has reached the end of the last sentence their page shows any of.
  expect(CHAPTERS[1]!.text.slice(0, located.viewport!.through)).toEndWith("终也舀不干。");
  expect(describeSpan(located.viewport!)).toBe("paragraph 1 sentence 1 through paragraph 2 sentence 0");
  expect(located.selections).toHaveLength(1);
  expect(describeSpan(located.selections[0]!)).toBe("paragraph 2 sentence 1");
});

test("a page across two chapters belongs to the one it ends in; a selection to the one it starts in", async () => {
  const seam: BookTextLocation = {
    start: { chapterIndex: 0, offset: CHAPTERS[0]!.text.indexOf("收尾") },
    end: { chapterIndex: 1, offset: CHAPTERS[1]!.text.indexOf("他回了") },
  };
  const located = await resolveReadingPosition({
    bookText: source(() => seam),
    bookId,
    cursor: { anchor: "page" },
    attachments: [{ text: "收尾一句。第二章", anchor: "selection" }],
  });
  expect(located.viewport).toMatchObject({
    chapterIndex: 1,
    start: 0,
    span: { start: { paragraph: 0, sentence: 0 }, end: { paragraph: 1, sentence: 0 } },
  });
  expect(located.selections[0]).toMatchObject({ chapterIndex: 0, end: CHAPTERS[0]!.text.length });
});

test("a continuous page over a file seam runs from its first document's start to its last one's end", async () => {
  // The reported location stays in the first document; the page goes on into the next.
  const located = await resolveReadingPosition({
    bookText: source((cfi) => (cfi === "second" ? at(1, "终也舀不干。竟是") : at(1, "他回了学校。"))),
    bookId,
    cursor: { anchor: "first", viewportAnchors: ["first", "second"], chapterIndex: 1 },
  });
  expect(describeSpan(located.viewport!)).toBe("paragraph 1 sentence 1 through paragraph 2 sentence 1");
  expect(CHAPTERS[1]!.text.slice(0, located.viewport!.through)).toEndWith("竟是越来越旺。\n");
  // One of them cannot be placed: the page is what the others cover.
  const partial = await resolveReadingPosition({
    bookText: source((cfi) => (cfi === "second" ? null : at(1, "他回了学校。"))),
    bookId,
    cursor: { anchor: "first", viewportAnchors: ["first", "second"] },
  });
  expect(describeSpan(partial.viewport!)).toBe("paragraph 1 sentence 1");
});

test("offsets a caller already holds are used as they are", async () => {
  const range = chapterRangeOf(CHAPTERS, 1, "终也舀不干。竟是越来越旺。");
  const located = await resolveReadingPosition({
    bookText: source(),
    bookId,
    cursor: { chapterIndex: 1, position: { start: range.start, end: range.end } },
    attachments: [{ text: "庄人都散了。", position: chapterRangeOf(CHAPTERS, 1, "庄人都散了。") }],
  });
  expect(describeSpan(located.viewport!)).toBe("paragraph 2 sentence 0 through paragraph 2 sentence 1");
  expect(located.viewport!.through).toBe(range.end + 1);
  expect(describeSpan(located.selections[0]!)).toBe("paragraph 3 sentence 0");
});

test("what cannot be placed leaves the turn without coordinates, not without a turn", async () => {
  const nowhere = await resolveReadingPosition({
    bookText: source(() => null),
    bookId,
    cursor: { anchor: "stale" },
    attachments: [{ text: "x", anchor: "stale" }, { text: "no anchor" }],
  });
  expect(nowhere).toEqual({ selections: [undefined, undefined] });
  // A host without the capability, a cursor without a location, a chapter that does not exist.
  expect(await resolveReadingPosition({ bookText: source(), bookId, cursor: { anchor: "page" } })).toEqual({
    selections: [],
  });
  expect(await resolveReadingPosition({ bookText: source(), bookId })).toEqual({ selections: [] });
  expect(
    await resolveReadingPosition({
      bookText: source(),
      bookId,
      cursor: { chapterIndex: 9, position: { start: 0, end: 4 } },
    }),
  ).toEqual({ selections: [] });
});

test("a paged book's coordinates are pages", async () => {
  const bookText = source();
  bookText.getChapterLayout = async () => ({ unit: "page", paragraphs: [0, 4], sentences: [0, 4, 9] });
  const located = await resolveReadingPosition({
    bookText,
    bookId,
    cursor: { chapterIndex: 0, position: { start: 5, end: 12 } },
  });
  expect(describeSpan(located.viewport!)).toBe("page 1 sentence 0 through page 1 sentence 1");
  expect(located.viewport!.blocks).toBe(2);
});

// A paged book's location names a page. Where on the page the reader is comes
// from the host's sample of what is on screen, found in the page's own text.
const PAGE =
  "The first lines of the page are above the window and the reader has scrolled past them already. " +
  "What the window shows begins with this sentence, which is long enough to be told apart. " +
  "It goes on through a second visible sentence. And it stops at the end of this one, here. " +
  "Below the window the page carries on with text the reader has not reached at all so far.";
const PAGED = [{ title: "A chapter of one page", text: PAGE }];
const squeezed = (text: string) => text.replace(/\s+/g, "");
function pagedSource(asked: (string | undefined)[] = []) {
  const { deps } = createInMemoryDeps({ chapters: { book: PAGED } });
  deps.bookText.getChapterLayout = async () => ({ unit: "page", paragraphs: [0], sentences: sentenceStarts(PAGE) });
  // As the host locates in a page: the whole page for its location alone, and
  // inside it for a quote found there once — whatever the whitespace between.
  deps.bookText.locate = async (_book, target) => {
    asked.push(target.textQuote?.exact);
    const whole = { start: { chapterIndex: 0, offset: 0 }, end: { chapterIndex: 0, offset: PAGE.length } };
    const quote = target.textQuote?.exact;
    if (!quote) return whole;
    const compact = squeezed(PAGE);
    const found = compact.indexOf(squeezed(quote));
    if (found < 0 || compact.indexOf(squeezed(quote), found + 1) >= 0) return whole;
    // Offsets of the compacted match, back in the page's own text.
    const positions = Array.from(PAGE).flatMap((char, index) => (/\s/.test(char) ? [] : [index]));
    return {
      start: { chapterIndex: 0, offset: positions[found] },
      end: { chapterIndex: 0, offset: positions[found + squeezed(quote).length - 1] + 1 },
    };
  };
  return deps.bookText;
}
const sentenceStarts = (text: string) => [0, ...[...text.matchAll(/\. /g)].map((match) => match.index + 2)];
const VISIBLE = PAGE.slice(PAGE.indexOf("What the window"), PAGE.indexOf(" Below the window"));

test("the part of a page on screen is found by what the reader's window shows", async () => {
  const asked: (string | undefined)[] = [];
  const located = await resolveReadingPosition({
    bookText: pagedSource(asked),
    bookId,
    // The host's sample has its own whitespace: lines joined with spaces.
    cursor: { anchor: "page", visibleText: VISIBLE.replace(/ /g, "  ") },
  });
  expect(PAGE.slice(located.viewport!.start, located.viewport!.end)).toBe(VISIBLE);
  expect(describeSpan(located.viewport!)).toBe("page 0 sentence 1 through page 0 sentence 3");
  // The reader has read through the last sentence in the window, not the page.
  expect(located.viewport!.through).toBe(PAGE.indexOf("Below the window"));
  // Short quotes from either end of the sample, never the sample itself.
  expect(asked.filter((quote) => quote !== undefined).every((quote) => quote.length <= 80)).toBe(true);
});

test("a window that runs onto the next page is placed by the end the page has", async () => {
  const start = PAGE.indexOf("What the window");
  // Its closing words are the next page's: only its opening is on this one.
  const overEnd = await resolveReadingPosition({
    bookText: pagedSource(),
    bookId,
    cursor: {
      anchor: "page",
      visibleText: `${PAGE.slice(start)} The next page begins with words this page does not have.`,
    },
  });
  expect([overEnd.viewport!.start, overEnd.viewport!.end]).toEqual([start, PAGE.length]);
  // Its opening words are the previous page's: only its closing is on this one.
  const end = PAGE.indexOf(" Below the window");
  const overStart = await resolveReadingPosition({
    bookText: pagedSource(),
    bookId,
    cursor: {
      anchor: "page",
      visibleText: `The page before ends with words this page does not have. ${PAGE.slice(0, end)}`,
    },
  });
  expect([overStart.viewport!.start, overStart.viewport!.end]).toEqual([0, end]);
});

test("a window that cannot be placed leaves the whole page, as a page without one does", async () => {
  const whole = [0, PAGE.length];
  for (const visibleText of [
    undefined,
    "Words that are nowhere on this page, from its first to its last, at either end of the sample.",
    // Elided by the host in the middle; both ends still say nothing.
    "Nothing here matches … and nothing here does either.",
  ]) {
    const located = await resolveReadingPosition({
      bookText: pagedSource(),
      bookId,
      cursor: { anchor: "page", ...(visibleText ? { visibleText } : {}) },
    });
    expect([located.viewport!.start, located.viewport!.end]).toEqual(whole);
  }
});

test("a book of flowing text is placed by its location alone: the window's words are not consulted", async () => {
  const asked: (string | undefined)[] = [];
  const bookText = source((_cfi, quote) => {
    asked.push(quote);
    return at(1, "爷从新街走出来。他回了学校。");
  });
  const located = await resolveReadingPosition({
    bookText,
    bookId,
    cursor: { anchor: "page", visibleText: "他回了学校。" },
  });
  expect(describeSpan(located.viewport!)).toBe("paragraph 1 sentence 0 through paragraph 1 sentence 1");
  expect(asked).toEqual([undefined]);
});
