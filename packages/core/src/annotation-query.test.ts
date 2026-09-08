import { expect, test } from "bun:test";
import { normalizeAnnotationPageQuery } from "./annotation-query";

test("annotation page defaults and filter normalization", () => {
  expect(normalizeAnnotationPageQuery()).toMatchObject({ limit: 20 });
  expect(normalizeAnnotationPageQuery({ query: "  习惯  ", limit: 100 })).toMatchObject({ query: "习惯", limit: 100 });
  expect(normalizeAnnotationPageQuery({ query: " " }).query).toBeUndefined();
});
test("annotation page rejects malformed filters, limits and cursors", () => {
  for (const input of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: NaN }, { query: 1 }, { query: "x".repeat(501) }, { bookId: "" }, { kind: "bad" }]) {
    expect(() => normalizeAnnotationPageQuery(input as never)).toThrow();
  }
  for (const cursor of ["", "x".repeat(8193), 12]) {
    expect(() => normalizeAnnotationPageQuery({ cursor: cursor as string })).toThrow();
  }
});
