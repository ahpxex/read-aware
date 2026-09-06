import { describe, expect, test } from "bun:test";
import { search, searchMatcher, type SearchOptions } from "../foliate-js/src/search";
import { indexText } from "../foliate-js/src/text-index";
import { textWalker } from "../foliate-js/src/text-walker";
import { withDom } from "./helpers/foliate-dom";

describe("text offset index", () => {
  test("keeps boundaries on real nodes, including empty chunks", () => {
    const index = indexText(["", "ab", "", "cd", ""]);
    expect(index.range(0, 2)).toEqual({ startIndex: 1, startOffset: 0, endIndex: 1, endOffset: 2 });
    expect(index.range(2, 4)).toEqual({ startIndex: 3, startOffset: 0, endIndex: 3, endOffset: 2 });
    expect(index.range(1, 3)).toEqual({ startIndex: 1, startOffset: 1, endIndex: 3, endOffset: 1 });
    expect(index.range(2, 2)).toEqual({ startIndex: 3, startOffset: 0, endIndex: 3, endOffset: 0 });
  });
  test("rejects invalid ranges", () => {
    expect(() => indexText([]).range(0, 0)).toThrow(RangeError);
    const index = indexText(["abc"]);
    for (const [start, end] of [[-1, 1], [2, 1], [0, 4], [0, NaN], [0.5, 1]]) {
      expect(() => index.range(start, end)).toThrow(RangeError);
    }
  });
});

describe("engine search", () => {
  test.each(["variant", "accent", "base", "case"] as const)("finds matches at the end of content (%s)", sensitivity => {
    const results = [...search(["abc"], "bc", { sensitivity })];
    expect(results).toHaveLength(1);
    expect(results[0].excerpt.match).toBe("bc");
    expect(results[0].range.endOffset).toBe(3);
  });
  test("preserves intermediate nodes in excerpts", () => {
    const results = [...search(["left A", "BCD", "E right"], "ABCDE", { sensitivity: "variant" })];
    expect(results[0].excerpt).toEqual({ pre: "left ", match: "ABCDE", post: " right" });
  });
  test("does not mistake identical endpoint strings for the same node", () => {
    expect([...search(["x", "y", "x"], "xyx")][0].excerpt.match).toBe("xyx");
  });
  test("overlapping matches may start before the preceding match ends", () => {
    const results = [...search(["a", "a", "a", "a"], "aa", { sensitivity: "variant" })];
    expect(results.map(result => result.range.startIndex)).toEqual([0, 1, 2]);
    expect(results.every(result => result.excerpt.match === "aa")).toBe(true);
  });
  test("whole words may cross inline element boundaries", () => {
    expect([...search(["hello wo", "rld"], "world", { granularity: "word" })][0].excerpt.match).toBe("world");
    expect([...search(["worldwide"], "world", { granularity: "word" })]).toEqual([]);
  });
  test("whitespace normalization preserves the exact source range", () => {
    const results = [...search(["a \n", "\t b"], "a b")];
    expect(results).toHaveLength(1);
    expect(results[0].excerpt.match).toBe("a \n\t b");
  });
  test("empty queries and content terminate without matches", () => {
    for (const options of [{ sensitivity: "variant" }, { sensitivity: "base" }] satisfies SearchOptions[]) {
      expect([...search([], "a", options)]).toEqual([]);
      expect([...search([""], "a", options)]).toEqual([]);
      expect([...search(["abc"], "", options)]).toEqual([]);
    }
    expect([...search(["abc"], "\u200e")]).toEqual([]);
  });
  test("case, diacritics, Unicode and locale controls remain independent", () => {
    expect([...search(["Café"], "cafe", { sensitivity: "base" })]).toHaveLength(1);
    expect([...search(["Café"], "cafe", { sensitivity: "accent" })]).toHaveLength(0);
    expect([...search(["Café"], "café", { sensitivity: "accent" })]).toHaveLength(1);
    expect([...search(["Café"], "café", { sensitivity: "variant" })]).toHaveLength(0);
    expect([...search(["İx"], "x", { sensitivity: "accent", locales: "en" })][0].range.startOffset).toBe(1);
    expect([...search(["a", "😀", "b"], "😀")][0].range).toEqual({ startIndex: 1, startOffset: 0, endIndex: 1, endOffset: 2 });
    expect([...search(["中文", "阅读"], "阅读", { locales: "zh" })][0].excerpt.match).toBe("阅读");
  });
});

describe("document text walking", () => {
  test("search returns DOM ranges and ignores script/style content", () => withDom(window => {
    const doc = window.document;
    doc.body.innerHTML = "<script>world</script><style>.world{color:red}</style><p>hello wo<em>rld</em></p>";
    const results = [...searchMatcher(textWalker, { matchWholeWords: true })(doc, "world")];
    expect(results).toHaveLength(1);
    expect(results[0].range.toString()).toBe("world");
    expect(results[0].range.startContainer.ownerDocument).toBe(doc);
  }));
  test("a text-node selection is clipped and maps back to original offsets", () => withDom(window => {
    const doc = window.document;
    doc.body.textContent = "Hello world!";
    const node = doc.body.firstChild!;
    const range = doc.createRange();
    range.setStart(node, 6);
    range.setEnd(node, 11);
    const results = [...textWalker(range, function* (strings, makeRange) {
      expect(strings).toEqual(["world"]);
      yield makeRange(0, 1, 0, 4);
    })];
    expect(results[0].toString()).toBe("orl");
    expect(results[0].startOffset).toBe(7);
  }));
  test("multi-node selections clip both edges", () => withDom(window => {
    const doc = window.document;
    doc.body.innerHTML = "<p>before world <em>and after</em></p>";
    const range = doc.createRange();
    range.setStart(doc.querySelector("p")!.firstChild!, 7);
    range.setEnd(doc.querySelector("em")!.firstChild!, 3);
    expect([...textWalker(range, function* (strings, makeRange) {
      expect(strings).toEqual(["world ", "and"]);
      yield makeRange(0, 0, 1, 3).toString();
    })]).toEqual(["world and"]);
  }));
});
