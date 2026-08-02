import { describe, expect, test } from "bun:test";
import type { TocEntry } from "./reader-types";
import { chapterProgressAt, normalizeReadingCursorText } from "./reading-cursor";

const toc: TocEntry[] = [
  { id: "a", href: "text/a.xhtml", label: "A", depth: 0, spineIndex: 0, fraction: 0.1 },
  { id: "b", href: "text/b.xhtml#start", label: "B", depth: 0, spineIndex: 1, fraction: 0.3 },
  { id: "b2", href: "text/b.xhtml#part-2", label: "B.2", depth: 1, spineIndex: 1, fraction: 0.3 },
  { id: "c", href: "text/c.xhtml", label: "C", depth: 0, spineIndex: 2, fraction: 0.7 },
];

describe("reading cursor derivation", () => {
  test("estimates chapter-relative progress and skips duplicate TOC ticks", () => {
    expect(chapterProgressAt(toc, "text/b.xhtml#start", 0.5)).toBeCloseTo(0.5);
  });

  test("clamps stale progress to the chapter bounds", () => {
    expect(chapterProgressAt(toc, "text/b.xhtml#start", 0.1)).toBe(0);
    expect(chapterProgressAt(toc, "text/b.xhtml#start", 0.9)).toBe(1);
  });

  test("normalizes and bounds visible text while retaining both edges", () => {
    const normalized = normalizeReadingCursorText(`start   ${"x".repeat(100)}   finish`, 30);
    expect(normalized?.length).toBe(30);
    expect(normalized?.startsWith("start")).toBe(true);
    expect(normalized?.endsWith("finish")).toBe(true);
    expect(normalized).toContain(" … ");
  });

  test("handles cursor bounds shorter than the elision marker", () => {
    expect(normalizeReadingCursorText("abcdef", 3)).toBe("abc");
    expect(normalizeReadingCursorText("abcdef", 0)).toBeUndefined();
  });
});
