import { describe, expect, test } from "bun:test";
import { sentenceReaderCopy, sentenceReaderUnits } from "../src/copy";

const TRANSLATED_LOCALES = ["de", "es", "fr", "ja", "ru", "zh-Hans", "zh-Hant"];

describe("Sentence Reader contribution metadata", () => {
  test("owns its semantic units and default-language copy", () => {
    expect(sentenceReaderUnits.map((unit) => unit.id)).toEqual(["sentence", "paragraph"]);
    expect(sentenceReaderUnits[1]?.icon).toBe("paragraph");
    expect(sentenceReaderCopy.title.default).toBe("Read by sentence or paragraph");
  });

  test("ships every app locale inside the plugin bundle", () => {
    expect(Object.keys(sentenceReaderCopy.title.translations ?? {}).sort()).toEqual(
      TRANSLATED_LOCALES,
    );
    for (const unit of sentenceReaderUnits) {
      expect(Object.keys(unit.label.translations ?? {}).sort()).toEqual(TRANSLATED_LOCALES);
      expect(Object.keys(unit.nextLabel.translations ?? {}).sort()).toEqual(TRANSLATED_LOCALES);
      expect(Object.keys(unit.previousLabel.translations ?? {}).sort()).toEqual(
        TRANSLATED_LOCALES,
      );
    }
  });
});
