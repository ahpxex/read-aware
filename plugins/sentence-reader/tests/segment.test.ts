import { describe, expect, test } from "bun:test";
import { segmentTextUnits } from "../src/segment";

function pieces(text: string, language = "en") {
  return segmentTextUnits({ text, language, granularity: "sentence" })
    .map(({ start, end }) => text.slice(start, end));
}

describe("Sentence Reader segmentation", () => {
  test("keeps punctuation and trims whitespace around English sentences", () => {
    const text = "  Hello world.  Next sentence!  ";
    expect(pieces(text)).toEqual(["Hello world.", "Next sentence!"]);
  });

  test("does not turn hard source line wraps into sentence boundaries", () => {
    const text = "A hard\nwrapped sentence. Next sentence.";
    expect(pieces(text)).toEqual([
      "A hard\nwrapped sentence.",
      "Next sentence.",
    ]);
  });

  test("uses locale-aware CJK sentence boundaries", () => {
    const text = "你好。世界！再见？";
    expect(pieces(text, "zh-CN")).toEqual(["你好。", "世界！", "再见？"]);
  });

  test("paragraph mode returns one trimmed block span", () => {
    const text = "  First sentence. Second sentence.  ";
    const spans = segmentTextUnits({ text, language: "en", granularity: "paragraph" });
    expect(spans).toEqual([{ start: 2, end: text.length - 2 }]);
  });

  test("falls back to the runtime locale for an invalid language tag", () => {
    expect(() => pieces("One. Two.", "not_a_locale")).not.toThrow();
    expect(pieces("One. Two.", "not_a_locale")).toEqual(["One.", "Two."]);
  });
});
