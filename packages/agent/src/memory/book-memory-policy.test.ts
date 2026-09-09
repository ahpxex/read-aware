import { expect, test } from "bun:test";
import type { ChapterDigest } from "@read-aware/core";
import { chapterMemoryPolicy, visibleChapterDigests } from "./book-memory-policy";
import { buildSystemPrompt } from "../context/system-prompt";
import { queryBookGraph } from "./book-graph";

const digests: ChapterDigest[] = [
  { chapterIndex: 0, summary: "Legacy summary", characters: [{ name: "Ada" }], relations: [], digestVersion: 2 },
  { chapterIndex: 1, summary: "Concept summary", characters: [{ name: "Entropy" }], relations: [], digestVersion: 2, flavor: "expository" },
  { chapterIndex: 2, summary: "Future summary", characters: [{ name: "Secret", aliases: ["Ada"] }], relations: [], digestVersion: 2, flavor: "narrative" },
];
test("unclassified chapter memory uses the conservative narrative policy; invalid positions withhold", () => {
  for (const index of [undefined, -1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    expect(chapterMemoryPolicy({ status: "reading" }, index)).toEqual({ flavor: "narrative", boundary: { kind: "unknown" } });
  }
  expect(chapterMemoryPolicy(undefined, 2).boundary).toEqual({ kind: "unknown" });
  expect(chapterMemoryPolicy({ status: "finished" }).boundary).toEqual({ kind: "all" });
  expect(chapterMemoryPolicy({ narrativity: "expository" }).boundary).toEqual({ kind: "all" });
  expect(visibleChapterDigests(digests, { kind: "before", chapterIndex: 1 }).map(d => d.chapterIndex)).toEqual([0]);
  expect(visibleChapterDigests(digests, { kind: "all" }).map(d => d.chapterIndex)).toEqual([0, 2]);
  expect(visibleChapterDigests(digests, { kind: "unknown" })).toEqual([]);
});
test("prompt and graph discard mismatched flavor and future aliases before merging", () => {
  for (const narrativity of [undefined, "narrative", "expository"] as const) {
    for (const status of ["reading", "finished"] as const) {
      const book = { id: "b", title: "Policy", status, narrativity };
      const policy = chapterMemoryPolicy(book, 1);
      const prompt = buildSystemPrompt({ kind: "book", bookId: "b" }, { book, currentChapter: { index: 1 }, chapterDigests: digests });
      const graph = JSON.stringify(queryBookGraph(digests, {}, policy.boundary, policy.flavor));
      const expected = visibleChapterDigests(digests, policy.boundary, policy.flavor);
      for (const row of digests) {
        expect(prompt.includes(row.summary)).toBe(expected.includes(row));
        expect(graph.includes(row.characters[0]!.name)).toBe(expected.includes(row));
      }
    }
  }
  const prompt = buildSystemPrompt({ kind: "book", bookId: "b" }, { book: { id: "b", title: "Unknown" }, chapterDigests: digests });
  expect(prompt).not.toContain("Legacy summary"); expect(prompt).not.toContain("Future summary");
});
