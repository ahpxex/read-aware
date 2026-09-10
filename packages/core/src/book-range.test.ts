import { expect, test } from "bun:test";
import { normalizeBookRangeQuery } from "./book-range";

const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2)" };
test("range query copies identity and quote, with bounded UTF-16 paging defaults", () => {
  const input = { range: { ...range, textQuote: { exact: "needle", prefix: " " } } };
  const query = normalizeBookRangeQuery(input);
  input.range.textQuote.exact = "changed";
  expect(query).toEqual({ range: { ...range, textQuote: { exact: "needle", prefix: " " } }, offset: 0, limit: 4000, contextChars: 240 });
});
test("unknown authority fields, malformed identity, and oversized requests fail closed", () => {
  for (const input of [null, [], { range, hrefs: [] }, { range, throughChapterIndex: 999 },
    ...[0, 1, 12001, NaN, Infinity, "2"].map(limit => ({ range, limit })),
    ...[-1, 0.1, Number.MAX_SAFE_INTEGER + 1].map(offset => ({ range, offset })),
    ...[-1, 2001, null].map(contextChars => ({ range, contextChars })),
    ...[{ bookId: " " }, { contentVersion: "" }, { cfi: "raw-cfi" }, { cfi: "x".repeat(8193) }, { grant: true },
      { textQuote: { exact: " " } }, { textQuote: { exact: "x".repeat(12001) } },
      { textQuote: { exact: "x", prefix: "x".repeat(2001) } }, { textQuote: { exact: "x", scope: "all" } }]
      .map(change => ({ range: { ...range, ...change } })),
  ]) expect(() => normalizeBookRangeQuery(input)).toThrow(expect.objectContaining({ code: "library/invalid-range" }));
});
