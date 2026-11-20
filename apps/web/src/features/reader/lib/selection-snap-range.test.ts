import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { snapSelectionRange } from "./selection-snap-range";

const visible = { isOnPage: () => true };

function documentWith(body: string) {
  return new JSDOM(`<!doctype html><html lang="zh"><body>${body}</body></html>`).window.document;
}

/** A range from `startText` at `startOffset` to `endText` at `endOffset`, found by text content. */
function rangeIn(doc: Document, start: [string, number], end: [string, number]): Range {
  const walker = doc.createTreeWalker(doc.body, 4);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  const find = (needle: string) => texts.find((node) => node.data.includes(needle))!;
  const range = doc.createRange();
  const startNode = find(start[0]);
  const endNode = find(end[0]);
  range.setStart(startNode, startNode.data.indexOf(start[0]) + start[1]);
  range.setEnd(endNode, endNode.data.indexOf(end[0]) + end[1]);
  return range;
}

test("a sentence missing its first character across inline markup snaps to the sentence", () => {
  const doc = documentWith("<p>前面一句。这件事<em>其实</em>非常重要。后面一句。</p>");
  const snapped = snapSelectionRange(rangeIn(doc, ["这件事", 1], ["非常重要", 4]), visible);
  expect(snapped?.toString()).toBe("这件事其实非常重要。");
});

test("an overshoot into the next paragraph is pulled back", () => {
  const doc = documentWith("<p>这件事其实非常重要。</p><p>后面一段的内容。</p>");
  const snapped = snapSelectionRange(rangeIn(doc, ["这件事", 0], ["后面", 1]), visible);
  expect(snapped?.toString()).toBe("这件事其实非常重要。");
});

test("a drop cap in its own element is part of the sentence", () => {
  const doc = documentWith('<p><span class="dropcap" style="float:left">这</span>件事其实非常重要。下一句。</p>');
  const snapped = snapSelectionRange(rangeIn(doc, ["件事", 0], ["重要。", 3]), visible);
  expect(snapped?.toString()).toBe("这件事其实非常重要。");
});

test("lines of verse broken by <br> are separate units", () => {
  const doc = documentWith("<p>床前明月光<br/>疑是地上霜<br/>举头望明月</p>");
  const snapped = snapSelectionRange(rangeIn(doc, ["床前", 0], ["疑是", 1]), visible);
  expect(snapped?.toString()).toBe("床前明月光");
});

test("an edge inside a ruby annotation moves to the edge of the ruby", () => {
  const doc = documentWith("<p>前文。<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>を勉強しています。後文。</p>");
  const snapped = snapSelectionRange(rangeIn(doc, ["かん", 1], ["います", 3]), visible);
  expect(snapped?.toString()).toBe("漢かん字じを勉強しています。");
});

test("a selection running off the page continues to the end of its sentence", () => {
  const doc = documentWith("<p>前面一句。这件事其实非常重要，大家都知道。后面一句。</p>");
  const range = rangeIn(doc, ["这件事", 0], ["非常", 1]);
  const hiddenFrom = range.endOffset;
  const snapped = snapSelectionRange(range, {
    isOnPage: (probe) => probe.startOffset < hiddenFrom,
  });
  expect(snapped?.toString()).toBe("这件事其实非常重要，大家都知道。");
});

test("without a page (a continuous scroll) the viewport edge does not extend a selection", () => {
  const doc = documentWith("<p>前面一句。这件事其实非常重要，大家都知道。后面一句。</p>");
  expect(snapSelectionRange(rangeIn(doc, ["这件事", 0], ["非常", 1]))).toBeNull();
});

test("an exact selection is left alone", () => {
  const doc = documentWith("<p>前面一句。这件事其实非常重要。后面一句。</p>");
  expect(snapSelectionRange(rangeIn(doc, ["这件事", 0], ["重要。", 3]), visible)).toBeNull();
});

test("a PDF text layer is only trimmed and word-completed", () => {
  const doc = documentWith(
    '<div class="textLayer"><span>前面一句。这件事其实非常重要。</span><span> Hello world again</span></div>',
  );
  expect(snapSelectionRange(rangeIn(doc, ["这件事", 1], ["重要", 2]), visible)).toBeNull();
  expect(snapSelectionRange(rangeIn(doc, ["Hello", 1], ["world", 3]), visible)?.toString()).toBe("Hello world");
});
