import { describe, expect, test } from "bun:test";
import {
  normalizeReaderMode,
  normalizeReaderTextSegments,
} from "./reader-mode";

describe("reader mode contract", () => {
  test("normalizes a text-unit mode without changing its segmenter", () => {
    const segmentText = () => [{ start: 0, end: 4 }];
    const mode = normalizeReaderMode({
      id: "sentence-reader",
      kind: "text-unit-navigator",
      granularities: ["sentence", "paragraph", "sentence"],
      segmentText,
    });

    expect(mode.granularities).toEqual(["sentence", "paragraph"]);
    expect(mode.segmentText).toBe(segmentText);
  });

  test("rejects unknown mode kinds and malformed registrations", () => {
    expect(() => normalizeReaderMode(null)).toThrow();
    expect(() => normalizeReaderMode({
      id: "reader",
      kind: "raw-dom",
      granularities: ["sentence"],
      segmentText: () => [],
    })).toThrow("unsupported reader mode kind");
  });

  test("accepts ordered spans and rejects overlaps or out-of-bounds offsets", () => {
    expect(normalizeReaderTextSegments(
      [{ start: 0, end: 4 }, { start: 5, end: 8 }],
      8,
    )).toEqual([{ start: 0, end: 4 }, { start: 5, end: 8 }]);
    expect(() => normalizeReaderTextSegments(
      [{ start: 0, end: 5 }, { start: 4, end: 8 }],
      8,
    )).toThrow("invalid or overlapping");
    expect(() => normalizeReaderTextSegments([{ start: 0, end: 9 }], 8)).toThrow();
  });
});
