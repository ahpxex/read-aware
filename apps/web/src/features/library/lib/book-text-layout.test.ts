import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { addressAt, blocksIn, type ChapterLayout } from "@read-aware/core";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { readSectionBlocks } from "../../reader/lib/reader-document-layout";
import { extractBookText } from "./book-text-extraction";
import { collapseText, locateInRecord, pageTextBlocks, sectionSpansOf } from "./book-text-layout";
import { parseBookTextRecord, type BookTextRecord } from "./book-text-record";
import { buildChapterMap } from "../../../../foliate-js/src/chapter-map";

const documents = (html: string[]) => html.map((text) => new JSDOM(text).window.document);
function book(docs: Document[], toc: FoliateBook["toc"], language?: string): FoliateBook {
  return {
    toc,
    metadata: language ? { language } : undefined,
    sections: docs.map((doc, index) => ({ id: `s${index}.html`, createDocument: async () => doc })),
    resolveHref: (href: string) => {
      const [file, id] = href.split("#");
      return { index: Number(file![1]), anchor: id ? (doc: Document) => doc.getElementById(id) : 0 };
    },
  } as FoliateBook;
}
const extract = async (source: FoliateBook) =>
  extractBookText(source, {
    bookId: "b",
    contentVersion: "sha256:test",
    prior: null,
    chapters: await buildChapterMap(source),
    signal: new AbortController().signal,
    yieldToReader: async () => {},
    save: async () => {},
    progress: () => {},
    warn: () => {},
  });
const blockTexts = (text: string, layout: ChapterLayout) =>
  blocksIn(layout, 0, text.length).map((block) => text.slice(block.start, block.end).trim());
/** The raw offsets of the first occurrence of `quote` in a section document, as a reader range would give them. */
function rawRange(doc: Document, quote: string): [number, number] {
  const start = doc.body.textContent!.indexOf(quote);
  if (start < 0) throw new Error(`fixture has no "${quote}"`);
  return [start, start + quote.length];
}

test("collapsing whitespace reports where every offset lands in the collapsed text", () => {
  const samples = ["", "   ", "a", "  a  b\n\n c\t", "\n第一段。\n\n  第二段。 尾 ", "x 　y  ", "ab", " a"];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 200; i++)
    samples.push(Array.from({ length: next() % 24 }, () => " \n\tab。"[next() % 6]!).join(""));
  for (const input of samples) {
    const marks = Array.from({ length: input.length + 1 }, (_, index) => index);
    const { text, at } = collapseText(input, marks);
    expect(text).toBe(input.replace(/\s+/g, " ").trim());
    for (const mark of marks) {
      const rest = input.slice(mark);
      const landing = mark + (rest.length - rest.trimStart().length);
      const expected =
        landing >= input.length ? text.length : input.slice(0, landing).replace(/\s+/g, " ").trimStart().length;
      expect([input, mark, at[mark]]).toEqual([input, mark, expected]);
    }
  }
});

test("a section's blocks are offsets into its text: block elements, text after them, and line breaks", () => {
  const [doc] = documents([
    '<div>lead<p>one <b>bold</b></p>tail<h2 id="x"></h2><h3>Head</h3><blockquote><p>quoted</p></blockquote>a<br/>b</div>',
  ]);
  const raw = doc!.body.textContent!;
  const { blocks, headings } = readSectionBlocks(doc!.body);
  const pieces = blocks.map((at, index) => raw.slice(at, blocks[index + 1] ?? raw.length)).filter(Boolean);
  expect(pieces).toEqual(["lead", "one bold", "tail", "Head", "quoted", "a", "b"]);
  // An empty heading is an anchor, not a heading of the block that follows it.
  expect(headings).toEqual([{ offset: raw.indexOf("Head"), level: 3 }]);
});

test("chapters carry blocks, sentences, headings and the section slices behind their text", async () => {
  const docs = documents([
    '<p>前言。</p>\n<h1 id="four">第4章</h1>\n<p>第四章正文。它有两句。</p>\n<h1 id="five">第5章</h1>\n<p>第五章前半。</p>\n',
    '<p>第五章后半。</p>\n<h2>小节</h2><p>小节正文。</p><h1 id="six">第6章</h1><p>第六章正文。</p>',
  ]);
  const record = await extract(
    book(
      docs,
      [
        { href: "s0.html#four", label: "第4章" },
        { href: "s0.html#five", label: "第5章" },
        { href: "s1.html#six", label: "第6章" },
      ],
      "zh",
    ),
  );
  expect(parseBookTextRecord(JSON.parse(JSON.stringify(record)), "b", "sha256:test")).not.toBeNull();
  const [, four, five, six] = record.chapters;
  expect(blockTexts(four!.text, four!.layout)).toEqual(["第4章", "第四章正文。它有两句。"]);
  expect(four!.layout.headings).toEqual([{ paragraph: 0, level: 1 }]);
  expect(four!.layout.sentences.map((at) => four!.text.slice(at, at + 3))).toEqual(["第4章", "第四章", "它有两"]);
  // A chapter continuing into the next file: its blocks there count on from the first file's.
  expect(blockTexts(five!.text, five!.layout)).toEqual(["第5章", "第五章前半。", "第五章后半。", "小节", "小节正文。"]);
  expect(five!.layout.headings).toEqual([
    { paragraph: 0, level: 1 },
    { paragraph: 3, level: 2 },
  ]);
  expect(five!.layout.unit).toBe("paragraph");
  expect(five!.sources.map(({ sectionIndex, at }) => [sectionIndex, five!.text.slice(at, at + 3)])).toEqual([
    [0, "第5章"],
    [1, "第五章"],
  ]);
  expect(blockTexts(six!.text, six!.layout)).toEqual(["第6章", "第六章正文。"]);

  // A reader range in a section resolves to the same text in its chapter.
  const cases: [number, string, number, { paragraph: number; sentence: number }][] = [
    [0, "它有两句", 1, { paragraph: 1, sentence: 1 }],
    [0, "第五章前半。", 2, { paragraph: 1, sentence: 0 }],
    [1, "第五章后半", 2, { paragraph: 2, sentence: 0 }],
    [1, "节正文", 2, { paragraph: 4, sentence: 0 }],
    [1, "第六章正文。", 3, { paragraph: 1, sentence: 0 }],
  ];
  for (const [section, quote, chapterIndex, address] of cases) {
    const located = locateInRecord(record, section, ...rawRange(docs[section]!, quote))!;
    const chapter = record.chapters[chapterIndex]!;
    expect(located.start.chapterIndex).toBe(chapterIndex);
    expect(chapter.text.slice(located.start.offset, located.end.offset)).toBe(quote);
    expect(addressAt(chapter.layout, located.start.offset)).toEqual(address);
  }
});

test("a range across whitespace, a chapter seam or a section edge lands on text", async () => {
  const docs = documents(['<p>  alpha   beta  </p>\n\n<h1 id="two">Two</h1>\n<p>gamma delta</p>\n', "<p>epsilon</p>"]);
  const record = await extract(book(docs, [{ href: "s0.html#two", label: "Two" }]));
  expect(record.chapters.map((chapter) => chapter.text)).toEqual(["alpha beta", "Two gamma delta epsilon"]);
  const raw = docs[0]!.body.textContent!;
  const at = (quote: string) => raw.indexOf(quote);
  // Whitespace around a selection is not part of it.
  const padded = locateInRecord(record, 0, at("alpha") - 1, at("beta") + 6)!;
  expect(record.chapters[0]!.text.slice(padded.start.offset, padded.end.offset)).toBe("alpha beta");
  // A start in the whitespace before the next word is that word.
  const gap = locateInRecord(record, 0, at("alpha") + 6, at("beta") + 4)!;
  expect(record.chapters[0]!.text.slice(gap.start.offset, gap.end.offset)).toBe("beta");
  // A viewport over two chapters of one file: each end reports its own chapter.
  const seam = locateInRecord(record, 0, at("beta"), at("gamma") + 5)!;
  expect([seam.start.chapterIndex, seam.end.chapterIndex]).toEqual([0, 1]);
  expect(record.chapters[1]!.text.slice(0, seam.end.offset)).toBe("Two gamma");
  // The end of a file is the end of its text there, and the next file begins a new block.
  const tail = locateInRecord(record, 0, at("delta"), raw.length)!;
  expect(record.chapters[1]!.text.slice(tail.start.offset, tail.end.offset)).toBe("delta");
  const next = locateInRecord(record, 1, 0, 3)!;
  expect(record.chapters[1]!.text.slice(next.start.offset, next.end.offset)).toBe("eps");
  expect(addressAt(record.chapters[1]!.layout, next.start.offset).paragraph).toBe(2);
  // A point is the sentence it sits in; a section the record never read is nowhere.
  const point = locateInRecord(record, 0, at("gamma") + 2, at("gamma") + 2)!;
  expect(point.start).toEqual(point.end);
  expect(point.start.chapterIndex).toBe(1);
  expect(locateInRecord(record, 7, 0, 1)).toBeNull();
});

test("a range of chapter text maps back to the section text it came from, across files", async () => {
  const docs = documents([
    '<p>  alpha   beta  </p>\n\n<h1 id="two">Two</h1>\n<p>gamma  delta</p>\n',
    "<p>epsilon zeta</p>\n<p>eta</p>",
  ]);
  const record = await extract(book(docs, [{ href: "s0.html#two", label: "Two" }]));
  const chapter = record.chapters[1]!;
  expect(chapter.text).toBe("Two gamma delta epsilon zeta eta");
  const raws = docs.map((doc) => doc.body.textContent!);
  // Every stretch of the chapter that starts and ends on text comes back as the same text.
  for (let start = 0; start < chapter.text.length; start++)
    for (let end = start + 1; end <= chapter.text.length; end++) {
      const wanted = chapter.text.slice(start, end);
      if (wanted !== wanted.trim()) continue;
      const spans = sectionSpansOf(record, 1, start, end);
      const back = spans.map((span) => raws[span.sectionIndex]!.slice(span.start, span.end).replace(/\s+/g, " "));
      expect([start, end, back.join(" ")]).toEqual([start, end, wanted]);
      // And locating those section ranges lands on the same chapter range.
      const first = locateInRecord(record, spans[0]!.sectionIndex, spans[0]!.start, spans[0]!.end)!;
      const last = spans[spans.length - 1]!;
      const tail = locateInRecord(record, last.sectionIndex, last.start, last.end)!;
      expect([first.start.offset, tail.end.offset]).toEqual([start, end]);
    }
  expect(sectionSpansOf(record, 1, 4, 4)).toEqual([]);
  expect(sectionSpansOf(record, 9, 0, 4)).toEqual([]);
  expect(sectionSpansOf(record, 1, 10, 23).map((span) => span.sectionIndex)).toEqual([0, 1]);
});

test("a paged book's blocks are its pages, split where a page has blank lines", async () => {
  expect(pageTextBlocks("one\ntwo\n\nthree\n \nfour")).toEqual([0, 9, 17]);
  const pages = [
    "1 Opening\nFirst page text runs on\nover lines.\n\nA second block.",
    "Second page.",
    "2 Closing\nThird page.",
  ];
  const source = {
    toc: [],
    sections: pages.map((text, index) => ({ id: index, getText: async () => text })),
    resolveHref: () => null,
  } as unknown as FoliateBook;
  const record: BookTextRecord = await extract(source);
  const all = record.chapters.flatMap((chapter) => blockTexts(chapter.text, chapter.layout));
  expect(all).toEqual([
    "1 Opening First page text runs on over lines.",
    "A second block.",
    "Second page.",
    "2 Closing Third page.",
  ]);
  expect(record.chapters.every((chapter) => chapter.layout.unit === "page")).toBe(true);
  const located = locateInRecord(record, 1, 0, pages[1]!.length)!;
  const chapter = record.chapters[located.start.chapterIndex]!;
  expect(chapter.text.slice(located.start.offset, located.end.offset)).toBe("Second page.");
});
