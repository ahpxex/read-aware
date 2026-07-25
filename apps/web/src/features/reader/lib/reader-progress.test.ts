import { describe, expect, test } from "bun:test";
import { buildProgressMarks, findMarkAt, pageAtFraction } from "./reader-progress";
import type { TocEntry } from "./reader-types";

const entry = (
  label: string,
  fraction: number | undefined,
  depth = 0,
): TocEntry => ({
  id: label,
  href: `${label}.xhtml`,
  label,
  depth,
  spineIndex: 0,
  fraction,
});

describe("buildProgressMarks", () => {
  test("sorts marks by position and drops unplaced entries", () => {
    expect(
      buildProgressMarks([
        entry("Two", 0.5),
        entry("Unplaced", undefined),
        entry("One", 0.1),
      ]),
    ).toEqual([
      { fraction: 0.1, label: "One" },
      { fraction: 0.5, label: "Two" },
    ]);
  });

  test("chapters sharing a spine file collapse onto the first of them", () => {
    expect(
      buildProgressMarks([entry("Chapter I", 0.25), entry("Chapter II", 0.25, 1)]),
    ).toEqual([{ fraction: 0.25, label: "Chapter I" }]);
  });

  test("clamps fractions the engine reports outside the book", () => {
    expect(buildProgressMarks([entry("Runaway", 1.0000001)])).toEqual([
      { fraction: 1, label: "Runaway" },
    ]);
  });
});

describe("findMarkAt", () => {
  const marks = buildProgressMarks([
    entry("Front matter", 0),
    entry("One", 0.2),
    entry("Two", 0.6),
  ]);

  test("returns the mark a position falls in", () => {
    expect(findMarkAt(marks, 0.4)?.label).toBe("One");
  });

  test("a position exactly on a mark belongs to it, not the one before", () => {
    expect(findMarkAt(marks, 0.6)?.label).toBe("Two");
  });

  test("a hair before a mark still belongs to the previous one", () => {
    expect(findMarkAt(marks, 0.6 - 1e-6)?.label).toBe("One");
  });

  test("tolerates the engine's Number.EPSILON nudge on mark fractions", () => {
    // getSectionFractions() nudges every fraction up by EPSILON, so a mark can
    // sit a float hair PAST the position it starts — it must still match.
    const nudged = [{ fraction: 0.2 + Number.EPSILON, label: "One" }];
    expect(findMarkAt(nudged, 0.2)?.label).toBe("One");
    // A real gap, though, is a real gap.
    expect(findMarkAt(nudged, 0.19)).toBeNull();
  });

  test("no mark at or before the position", () => {
    expect(findMarkAt(buildProgressMarks([entry("One", 0.2)]), 0.1)).toBeNull();
  });
});

describe("pageAtFraction", () => {
  test("rounds to the nearest page", () => {
    expect(pageAtFraction(0.5, 400)).toBe(200);
    expect(pageAtFraction(0.5013, 400)).toBe(201);
  });

  test("never lands before the first page or past the last", () => {
    expect(pageAtFraction(0, 400)).toBe(1);
    expect(pageAtFraction(1, 400)).toBe(400);
  });

  test("a book with no reported pages has no page to name", () => {
    expect(pageAtFraction(0.5, 0)).toBe(0);
  });
});
