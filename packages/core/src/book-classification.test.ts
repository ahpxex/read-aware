import { expect, test } from "bun:test";
import { normalizeBookClassification, type BookClassificationChange } from "./book-classification";

test("classification changes require an exact scoped revision and copy known fields", () => {
  const input: BookClassificationChange = { bookId: "b", narrativity: "expository", expectedRevision: `bcl1:${"a".repeat(64)}` };
  const copy = normalizeBookClassification(input); expect(copy).toEqual(input); expect(copy).not.toBe(input);
  for (const raw of [null, [], {}, { ...input, bookId: " " }, { ...input, bookId: "a".repeat(257) },
    { ...input, narrativity: null }, { ...input, narrativity: "poetry" }, { ...input, expectedRevision: `mem1:${"a".repeat(64)}` },
    { ...input, expectedRevision: `bcl1:${"A".repeat(64)}` }, { ...input, onlyIfUnclassified: true }]) {
    expect(() => normalizeBookClassification(raw as BookClassificationChange)).toThrow(expect.objectContaining({ code: "memory/invalid-input" }));
  }
});
