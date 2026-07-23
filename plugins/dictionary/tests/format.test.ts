import { describe, expect, test } from "bun:test";
import type { PluginDictionaryEntry, PluginDocument } from "@read-aware/plugin-types";
import { savedWordsCsv } from "../src/export";
import { definitionOf, idFor } from "../src/format";
import type { SavedWord } from "../src/types";

const entry: PluginDictionaryEntry = {
  headword: "serendipity",
  pronunciation: "/ˌserənˈdipədē/",
  senses: [
    {
      partOfSpeech: "noun",
      definition: 'a happy, "unexpected" discovery',
      examples: ["It was pure serendipity."],
    },
  ],
  etymology: "Coined by Horace Walpole.",
  contextualMeaning: "A fortunate accident.",
};

describe("dictionary formatting", () => {
  test("uses a stable case-insensitive document identity", () => {
    expect(idFor("  Serendipity ", "English")).toBe("English serendipity");
  });

  test("summarizes the first dictionary sense", () => {
    expect(definitionOf(entry)).toBe('(noun) a happy, "unexpected" discovery');
  });

  test("exports a UTF-8 Excel-friendly CSV with escaped cells", () => {
    const saved: PluginDocument<SavedWord>[] = [
      {
        id: "English serendipity",
        updatedAt: "2026-07-24T00:00:00.000Z",
        data: {
          term: "serendipity",
          language: "English",
          targetLanguage: "en",
          entry,
          bookTitle: "Frankenstein",
          context: "A happy, unexpected discovery.",
          addedAt: "2026-07-24T00:00:00.000Z",
        },
      },
    ];

    const csv = savedWordsCsv(saved);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"noun: a happy, ""unexpected"" discovery');
    expect(csv).toContain('"Frankenstein"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
