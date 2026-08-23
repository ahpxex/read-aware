/**
 * Read-model projection drift tests. Fields written by a pipeline and consumed
 * by the agent must cross the real LibraryBook -> BookSummary boundary here.
 */
import { describe, expect, test } from "bun:test";
import type { LibraryBook } from "../features/library/lib/library-types";
import { toBookSummary } from "./library";

const base: LibraryBook = {
  id: "b1",
  title: "乌合之众",
  author: "勒庞",
  format: "epub",
  fileName: "b.epub",
  mimeType: "application/epub+zip",
  fileSize: 42,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  lastOpenedAt: null,
  progressPercent: 10,
  readingStatus: "reading",
  progress: null,
};

describe("toBookSummary", () => {
  test("carries narrativity through to the canonical read model", () => {
    expect(toBookSummary({ ...base, narrativity: "expository" }).narrativity).toBe(
      "expository",
    );
    expect(toBookSummary({ ...base, narrativity: "narrative" }).narrativity).toBe(
      "narrative",
    );
  });

  test("unclassified books stay undefined", () => {
    expect(toBookSummary(base).narrativity).toBeUndefined();
    expect(toBookSummary({ ...base, narrativity: null }).narrativity).toBeUndefined();
  });
});
