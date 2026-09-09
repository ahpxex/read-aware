import { expect, test } from "bun:test";
import { lookupCacheId } from "../src/lookup";

test("lookup identity includes the book title and preserves structured input boundaries", () => {
  expect(lookupCacheId(" Term ", "English", "a", "Book A")).toBe(lookupCacheId("term", "English", "a", "Book A"));
  expect(lookupCacheId("term", "English", "a", "Book A")).not.toBe(lookupCacheId("term", "English", "a", "Book B"));
  expect(lookupCacheId("term", "English", "a", "Book A")).not.toBe(lookupCacheId("term", "English", "a", undefined));
  expect(lookupCacheId("term", "English", "a", "Book A")).not.toBe(lookupCacheId("term", "Japanese", "a", "Book A"));
});
