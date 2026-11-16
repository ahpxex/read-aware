import { expect, test } from "bun:test";
import {
  addressAt,
  blocksIn,
  buildChapterLayout,
  MAX_SENTENCE_CHARS,
  offsetOf,
  parseChapterLayout,
  readWindow,
  sentenceCount,
  sentenceEndAt,
  spanAt,
} from "./book-layout";

const text = "第一章 开端 他来了。她走了！谁知道呢？ 第二段只有一句。 Third block. It has two.";
const starts = [0, text.indexOf("他来了"), text.indexOf("第二段"), text.indexOf("Third")];
const layout = buildChapterLayout(text, starts, { headings: [{ offset: 0, level: 2 }] });

test("blocks and sentences are start offsets into the unchanged text", () => {
  expect(layout.paragraphs).toEqual(starts);
  expect(layout.headings).toEqual([{ paragraph: 0, level: 2 }]);
  expect(layout.sentences.map((at) => text.slice(at, at + 3))).toEqual(["第一章", "他来了", "她走了", "谁知道", "第二段", "Thi", "It "]);
  expect([0, 1, 2, 3].map((paragraph) => sentenceCount(layout, paragraph))).toEqual([1, 3, 1, 2]);
  expect(parseChapterLayout(JSON.parse(JSON.stringify(layout)), text.length)).toEqual(layout);
});

test("an offset and its address convert both ways", () => {
  for (const [index, at] of layout.sentences.entries()) {
    const address = addressAt(layout, at);
    expect(offsetOf(layout, text.length, address)).toBe(at);
    // Any character of a sentence resolves to that sentence.
    const end = layout.sentences[index + 1] ?? text.length;
    expect(addressAt(layout, end - 1)).toEqual(address);
    expect(sentenceEndAt(layout, text.length, at)).toBe(end);
  }
  expect(addressAt(layout, text.indexOf("谁知道") + 1)).toEqual({ paragraph: 1, sentence: 2 });
  expect(addressAt(layout, 10_000)).toEqual({ paragraph: 3, sentence: 1 });
  expect(offsetOf(layout, text.length, { paragraph: 1, sentence: 9 })).toBe(starts[2]!);
  expect(offsetOf(layout, text.length, { paragraph: 9, sentence: 0 })).toBe(text.length);
});

test("a range reports the sentences it starts and ends in", () => {
  const start = text.indexOf("她走了");
  expect(spanAt(layout, start, text.indexOf("第二段") + 2)).toEqual({
    start: { paragraph: 1, sentence: 1 },
    end: { paragraph: 2, sentence: 0 },
  });
  expect(spanAt(layout, start, start)).toEqual({ start: { paragraph: 1, sentence: 1 }, end: { paragraph: 1, sentence: 1 } });
});

test("a bounded read takes whole sentences and says where the rest begins", () => {
  const from = text.indexOf("他来了");
  const first = readWindow(layout, text.length, { from: from + 1, budget: 9 });
  expect(text.slice(first.start, first.end)).toBe("他来了。她走了！");
  expect(first.next).toBe(first.end);
  // One sentence is returned even when it alone exceeds the budget.
  const tight = readWindow(layout, text.length, { from, budget: 1 });
  expect(text.slice(tight.start, tight.end)).toBe("他来了。");
  // A ceiling is honoured on a sentence boundary, and nothing follows it.
  const ceiling = text.indexOf("第二段");
  const fenced = readWindow(layout, text.length, { from, to: ceiling, budget: 10_000 });
  expect(text.slice(fenced.start, fenced.end)).toBe("他来了。她走了！谁知道呢？ ");
  expect(fenced.next).toBeNull();
  expect(readWindow(layout, text.length, { from: ceiling, to: ceiling, budget: 100 })).toEqual({ start: ceiling, end: ceiling, next: null });
  const rest = readWindow(layout, text.length, { from: 0, budget: 10_000 });
  expect(rest).toEqual({ start: 0, end: text.length, next: null });
});

test("blocks of a range carry their heading level and the slice inside the range", () => {
  const from = text.indexOf("她走了");
  expect(blocksIn(layout, 0, from).map(({ paragraph, level }) => [paragraph, level])).toEqual([
    [0, 2],
    [1, undefined],
  ]);
  const [block] = blocksIn(layout, from, from + 4);
  expect(text.slice(block!.start, block!.end)).toBe("她走了！");
  expect(blocksIn(layout, 5, 5)).toEqual([]);
});

test("text without sentence punctuation is still cut into bounded units", () => {
  const long = "数".repeat(MAX_SENTENCE_CHARS * 2 + 10) + "😀".repeat(3);
  const cut = buildChapterLayout(long, [0]);
  expect(cut.sentences).toEqual([0, MAX_SENTENCE_CHARS, MAX_SENTENCE_CHARS * 2]);
  const pairs = buildChapterLayout("😀".repeat(MAX_SENTENCE_CHARS), [0]);
  // Never between the halves of a surrogate pair.
  expect(pairs.sentences).toEqual([0, MAX_SENTENCE_CHARS, MAX_SENTENCE_CHARS * 2].slice(0, pairs.sentences.length));
  expect(pairs.sentences.every((at) => at % 2 === 0)).toBe(true);
});

test("block starts are normalised and a mismatched layout is rejected", () => {
  const short = buildChapterLayout("abc def.", [4, 4, 99, -1, 2.5]);
  expect(short.paragraphs).toEqual([0, 4]);
  expect(buildChapterLayout("", [])).toEqual({ unit: "paragraph", paragraphs: [0], sentences: [0] });
  expect(buildChapterLayout("page one", [], { unit: "page" }).unit).toBe("page");
  expect(parseChapterLayout({ ...layout, paragraphs: [0, 999] }, text.length)).toBeNull();
  expect(parseChapterLayout({ ...layout, sentences: [0] }, text.length)).toBeNull();
  expect(parseChapterLayout({ ...layout, headings: [{ paragraph: 9, level: 1 }] }, text.length)).toBeNull();
  expect(parseChapterLayout({ ...layout, unit: "line" }, text.length)).toBeNull();
});
