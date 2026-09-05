import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import * as CFI from "../foliate-js/src/epubcfi";

const dom = new JSDOM();
const parser = new dom.window.DOMParser();
const previousNodeFilter = Object.getOwnPropertyDescriptor(globalThis, "NodeFilter");

beforeAll(() => {
  Object.defineProperty(globalThis, "NodeFilter", {
    value: dom.window.NodeFilter,
    configurable: true,
  });
});
afterAll(() => {
  if (previousNodeFilter) Object.defineProperty(globalThis, "NodeFilter", previousNodeFilter);
  else Reflect.deleteProperty(globalThis, "NodeFilter");
  dom.window.close();
});

function xhtml(body: string): Document {
  return parser.parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${body}</body></html>`,
    "application/xhtml+xml",
  );
}

describe("CFI paths and ranges", () => {
  test("a path has exactly one part per indirection", () => {
    expect(CFI.parse("epubcfi(/6/2!/4/2/1:5)")).toEqual([
      [{ index: 6 }, { index: 2 }],
      [{ index: 4 }, { index: 2 }, { index: 1, offset: 5 }],
    ]);
    expect(CFI.parse("/2/4")).toEqual([[{ index: 2 }, { index: 4 }]]);
  });

  test("range endpoints are not shifted by an extra prefix", () => {
    const range = "epubcfi(/6/2!/4/2,/1:0,/1:5)";
    expect(CFI.parse(range)).toEqual({
      parent: [[{ index: 6 }, { index: 2 }], [{ index: 4 }, { index: 2 }]],
      start: [[{ index: 1, offset: 0 }]],
      end: [[{ index: 1, offset: 5 }]],
    });
    expect(CFI.collapse(range)).toBe("epubcfi(/6/2!/4/2/1:0)");
    expect(CFI.collapse(range, true)).toBe("epubcfi(/6/2!/4/2/1:5)");
  });

  test.each([
    ["/6/4!/10", "/6/4!/10", 0],
    ["/6/4!/2/3:0", "/6/4!/2", 1],
    ["/6/4!/2/4/6/8/10/3:0", "/6/4!/4", -1],
    ["/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]", "/6/4!/4/10", 0],
    ["/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]", "/6/4!/4/12", -1],
    ["/6/4", "/6/4!/2", -1],
    ["/6/4!/2", "/6/4!/2!/2", -1],
    ["/6/4!/4/2,/1:0,/1:5", "/6/4!/4/2,/1:0,/1:6", -1],
  ] as const)("compares %s and %s", (left, right, expected) => {
    expect(CFI.compare(left, right)).toBe(expected);
    expect(CFI.compare(right, left)).toBe(expected === 0 ? 0 : -expected);
  });

  test("preserves text, temporal, spatial and side assertions", () => {
    expect(CFI.parse("/4/1:3[before,after;s=b]~2.5@10:20")).toEqual([[
      { index: 4 },
      { index: 1, offset: 3, text: ["before", "after"], side: "b", temporal: 2.5, spatial: [10, 20] },
    ]]);
  });

  test("keeps synthetic spine indices stable", () => {
    for (const index of [0, 1, 10, 500]) {
      const parsed = CFI.parse(CFI.fake.fromIndex(index));
      expect(Array.isArray(parsed)).toBe(true);
      if (Array.isArray(parsed)) expect(CFI.fake.toIndex(parsed[0])).toBe(index);
    }
  });

  test("preserves Calibre positions and highlights", () => {
    expect(CFI.fromCalibrePos("/2/4/2/1:5")).toBe("epubcfi(/6/2!/2/1:5)");
    expect(CFI.fromCalibreHighlight({
      spine_index: 2, start_cfi: "/2/4/2/1:6", end_cfi: "/2/4/2/1:11",
    })).toBe("epubcfi(/6/6!/4/2,/1:6,/1:11)");
  });

  test("rejects incomplete ranges", () => {
    expect(() => CFI.parse("/4/2,/1:3")).toThrow("two endpoints");
    expect(() => CFI.parse(":3")).toThrow("without a step");
  });
});

describe("CFI DOM round trips", () => {
  test("restores the exact selection, not an empty range", () => {
    const doc = xhtml("<p>Hello world, test selection.</p>");
    const text = doc.querySelector("p")!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    const value = CFI.fromRange(range);
    expect(value).toBe("epubcfi(/4/2,/1:6,/1:11)");
    expect(CFI.toRange(doc, CFI.parse(value)).toString()).toBe("world");
  });

  // The upstream MIT-licensed regression cases cover CFI's logical text chunks
  // and FILTER_SKIP semantics, including foliate-js issue #100.
  // https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/tests/epubcfi-tests.js
  test.each([
    "<p>xxx<em>yyy</em>0123456789</p>",
    "<p>xxx<em>yyy</em><!--one-->01234<!--two-->567&#56;&#57;</p>",
  ])("text chunks survive comments: %s", (body) => {
    const doc = xhtml(body);
    for (let index = 0; index < 10; index++) {
      const range = CFI.toRange(doc, CFI.parse(`/4/2,/3:${index},/3:${index + 1}`));
      expect(range.toString()).toBe(String(index));
      expect(CFI.toRange(doc, CFI.parse(CFI.fromRange(range))).toString()).toBe(String(index));
    }
  });

  // jsdom does not implement CDATA Range offsets. That case is exercised by
  // tests/runtime/foliate-regressions.ts in the actual Tauri webview, not patched here.

  test("skips wrappers while retaining offsets across their text nodes", () => {
    const doc = xhtml('<p id="sample"><span class="skip">H</span>e<span class="skip">ll</span>o, World</p>');
    const filter: CFI.CFIFilter = (node) => node.nodeType === 1
      && node instanceof dom.window.Element && node.classList.contains("skip")
      ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
    const range = CFI.toRange(doc, CFI.parse("/4/2[sample],/1:3,/1:8"), filter);
    expect(range.toString()).toBe("lo, W");
    expect(CFI.fromRange(range, filter)).toBe("epubcfi(/4/2[sample],/1:3,/1:8)");
  });

  test("rejects injected elements without changing original text coordinates", () => {
    const doc = xhtml('<aside>Ignored</aside><p>0123456789</p>');
    const filter: CFI.CFIFilter = (node) => node.nodeName === "aside"
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    expect(CFI.toRange(doc, CFI.parse("/4/2,/1:2,/1:5"), filter).toString()).toBe("234");
  });

  test("resolves escaped IDs and generates stable element CFIs", () => {
    const doc = xhtml('<p id="para]/0,/5">Hello</p><p id="next">World</p>');
    const elements = [...doc.querySelectorAll("p")];
    const values = CFI.fromElements(elements);
    expect(values).toEqual(["epubcfi(/4/2[para^]/0^,/5])", "epubcfi(/4/4[next])"]);
    for (const [index, value] of values.entries()) {
      const parsed = CFI.parse(value);
      if (!Array.isArray(parsed)) throw new Error("Expected point CFI");
      expect(CFI.toElement(doc, parsed[0])).toBe(elements[index]);
    }
  });

  test("rejects missing nodes and out-of-bounds offsets instead of fabricating locations", () => {
    const doc = xhtml("<p>hello</p>");
    expect(() => CFI.toRange(doc, CFI.parse("/4/100/1:0"))).toThrow();
    expect(() => CFI.toRange(doc, CFI.parse("/4/2/1:100"))).toThrow();
    expect(CFI.fromElements([])).toEqual([]);
  });
});
