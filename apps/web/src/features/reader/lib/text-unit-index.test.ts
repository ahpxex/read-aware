import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { buildTextUnitRanges, textUnitText } from "./text-unit-index";
import { decodePluginCallbacks, PluginCallbackRegistry } from "../../plugins/runtime/plugin-callback-wire";

const dom = new JSDOM();
const saved = new Map(
  ["Node", "NodeFilter", "Range"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
beforeAll(() => {
  for (const key of saved.keys())
    Object.defineProperty(globalThis, key, { configurable: true, value: Reflect.get(dom.window, key) });
});
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
});
const documentWith = (html: string) => new dom.window.DOMParser().parseFromString(html, "text/html");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test.each(["accepted", "invalid", "cancelled"])(
  "%s segmentation releases all returned callback handles",
  async (mode) => {
    const doc = documentWith("<p>Text.</p>");
    const controller = new AbortController(),
      callbacks = new PluginCallbackRegistry();
    const pending = Promise.withResolvers<Array<{ start: number; end: number }>>();
    const build = buildTextUnitRanges(doc, "sentence", () => pending.promise, controller.signal).catch(
      (error) => error,
    );
    if (mode === "cancelled") controller.abort(new Error("Cancelled"));
    const result = decodePluginCallbacks(
      callbacks.encode([{ start: 0, end: mode === "invalid" ? 99 : 5, extra: () => {} }]),
      (handle, args) => callbacks.invoke(handle, args),
      (handles) => callbacks.release(handles),
    );
    pending.resolve(result as Array<{ start: number; end: number }>);
    const outcome = await build;
    if (mode === "accepted") expect(outcome.map((range: Range) => range.toString())).toEqual(["Text."]);
    else expect(outcome).toBeInstanceOf(Error);
    expect(callbacks.size).toBe(0);
  },
);

test("bounded concurrent segmentation preserves document order and inline node offsets", async () => {
  const doc = documentWith(Array.from({ length: 19 }, (_, i) => `<p>Block <em>${i}</em>.</p>`).join(""));
  let active = 0,
    peak = 0;
  const units = await buildTextUnitRanges(doc, "paragraph", async ({ text }) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, text.includes("0") ? 4 : 1));
    active--;
    return [{ start: 0, end: text.length }];
  });
  expect(peak).toBe(8);
  expect(units.map((range) => range.toString())).toEqual(Array.from({ length: 19 }, (_, i) => `Block ${i}.`));
});

test("a rejected block invalidates the section instead of silently omitting its text", async () => {
  const doc = documentWith("<p>First.</p><p>Second.</p>");
  await expect(
    buildTextUnitRanges(doc, "sentence", async ({ text }) => {
      if (text === "Second.") throw new Error("offline");
      return [{ start: 0, end: text.length }];
    }),
  ).rejects.toMatchObject({ code: "reader/segmentation-failed", cause: { message: "offline" } });
});

test("malformed offsets fail; a provider's intentional empty result is valid", async () => {
  const doc = documentWith("<p>Text.</p>");
  await expect(buildTextUnitRanges(doc, "sentence", () => [{ start: 0, end: 999 }])).rejects.toMatchObject({
    code: "reader/segmentation-failed",
  });
  expect(await buildTextUnitRanges(doc, "sentence", () => [])).toEqual([]);
});

test("cancelled work dispatches no further blocks and never builds ranges from late replies", async () => {
  const doc = documentWith(Array.from({ length: 30 }, () => "<p>Text.</p>").join(""));
  const owner = new AbortController();
  const pending: (() => void)[] = [];
  const work = buildTextUnitRanges(
    doc,
    "sentence",
    ({ text }) => new Promise((resolve) => pending.push(() => resolve([{ start: 0, end: text.length }]))),
    owner.signal,
  );
  const caught = work.catch((error) => error);
  expect(pending).toHaveLength(8);
  owner.abort(new Error("cancelled"));
  for (const resolve of pending) resolve();
  expect(await caught).toMatchObject({ message: "cancelled" });
  await tick();
  expect(pending).toHaveLength(8);
  let invoked = false;
  await expect(
    buildTextUnitRanges(
      doc,
      "sentence",
      () => {
        invoked = true;
        return [];
      },
      owner.signal,
    ),
  ).rejects.toThrow("cancelled");
  expect(invoked).toBe(false);
});

test("first failure prevents a backlog of new Worker requests", async () => {
  const doc = documentWith(Array.from({ length: 40 }, () => "<p>Text.</p>").join(""));
  let calls = 0;
  await expect(
    buildTextUnitRanges(doc, "sentence", async ({ text }) => {
      if (++calls === 1) throw new Error("failed");
      await tick();
      return [{ start: 0, end: text.length }];
    }),
  ).rejects.toMatchObject({ code: "reader/segmentation-failed" });
  await tick();
  expect(calls).toBe(8);
});

test("note reference markers and ruby annotations stay out of the segmented text", async () => {
  const doc = documentWith(
    '<p>He said hello.<sup>1</sup> Then he left.<a epub:type="noteref" href="#n2">2</a> Water is H<sub>2</sub>O.</p>' +
      "<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>を読む。</p>",
  );
  const seen: string[] = [];
  const units = await buildTextUnitRanges(doc, "paragraph", async ({ text }) => {
    seen.push(text);
    return [{ start: 0, end: text.length }];
  });
  expect(seen).toEqual(["He said hello. Then he left. Water is H2O.", "漢字を読む。"]);
  // Ranges still span the live DOM; the highlight covers the markers in between.
  expect(units.map((range) => range.toString())).toEqual([
    "He said hello.1 Then he left.2 Water is H2O.",
    "漢かん字じを読む。",
  ]);
});

// DOMParser documents have no window; these need computed styles.
const styledDocumentWith = (html: string) => new JSDOM(html).window.document;

test("text after a nested block stays with that block; hidden subtrees are neither text nor boundaries", async () => {
  const doc = styledDocumentWith(
    "<div>Intro.<p>Para.</p>Tail.</div>" + '<div style="display:none"><p>Hidden.</p></div>' + "<p>Last.</p>",
  );
  const seen: string[] = [];
  await buildTextUnitRanges(doc, "paragraph", async ({ text }) => {
    seen.push(text);
    return [{ start: 0, end: text.length }];
  });
  expect(seen).toEqual(["Intro.", "Para.Tail.", "Last."]);
});

test("a long section styles each element once instead of rescanning per block", async () => {
  const doc = styledDocumentWith(Array.from({ length: 400 }, (_, i) => `<p>Sentence ${i}.</p>`).join(""));
  const view = doc.defaultView!;
  const original = view.getComputedStyle.bind(view);
  let styled = 0;
  view.getComputedStyle = ((el: Element) => {
    styled++;
    return original(el);
  }) as typeof view.getComputedStyle;
  const units = await buildTextUnitRanges(doc, "sentence", ({ text }) => [{ start: 0, end: text.length }]);
  expect(units).toHaveLength(400);
  expect(styled).toBeLessThanOrEqual(400);
});

// The text layer of a PDF page: one span per typeset line, a <br> between
// them, no trailing spaces.
const typesetPage = `<div class="textLayer"><span>It is the accumulation of many</span><br><span>missteps that leads to a</span><br><span>problem.</span><br><span>The impact created by a change</span><br><span>is small. Imagine.</span><br></div>`;
/** Sentence ends as a terminator followed by whitespace, the way UAX #29 needs them. */
const sentences = ({ text }: { text: string }) => {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/\S[^.]*\./g))
    spans.push({ start: match.index, end: match.index + match[0].length });
  return spans;
};

test("a line break separates words: sentences end at the ends of typeset lines", async () => {
  const doc = documentWith(typesetPage);
  const seen: string[] = [];
  const units = await buildTextUnitRanges(doc, "sentence", (input) => {
    seen.push(input.text);
    return sentences(input);
  });
  // The segmenter is given the breaks...
  expect(seen).toEqual([
    "It is the accumulation of many\nmissteps that leads to a\nproblem.\nThe impact created by a change\nis small. Imagine.\n",
  ]);
  // ...and each unit reads with them as spaces, across the spans it covers.
  expect(units.map((unit) => textUnitText(unit).replace(/\s+/g, " "))).toEqual([
    "It is the accumulation of many missteps that leads to a problem.",
    "The impact created by a change is small.",
    "Imagine.",
  ]);
  // A unit starts and ends in text, on the lines it names.
  expect(units[1].startContainer.nodeValue).toBe("The impact created by a change");
  expect(units[1].endContainer.nodeValue).toBe("is small. Imagine.");
  expect(units[1].endOffset).toBe("is small.".length);
});

test("a boundary on a line break moves inward to the text beside it", async () => {
  // "One\ntwo\n\nthree": a third-party mode need not trim its segments.
  const doc = documentWith("<p>One<br>two<br><br>three</p>");
  const units = await buildTextUnitRanges(doc, "x", () => [
    // Ends on the break after "One".
    { start: 0, end: 4 },
    { start: 4, end: 7 },
    // Starts on the breaks before "three".
    { start: 7, end: 14 },
  ]);
  expect(units.map((unit) => unit.toString())).toEqual(["One", "two", "three"]);
  // A segment of nothing but breaks names no text, and makes no unit.
  const gaps = await buildTextUnitRanges(documentWith("<p>a<br><br>b</p>"), "x", () => [
    { start: 0, end: 1 },
    { start: 1, end: 3 },
    { start: 3, end: 4 },
  ]);
  expect(gaps.map((unit) => unit.toString())).toEqual(["a", "b"]);
});

test("a unit inside one text node reads as that text", () => {
  const doc = documentWith("<p>Plain sentence. Another.</p>");
  const range = doc.createRange();
  range.setStart(doc.querySelector("p")!.firstChild!, 0);
  range.setEnd(doc.querySelector("p")!.firstChild!, 15);
  expect(textUnitText(range)).toBe("Plain sentence.");
});
