import type { PluginContext, PluginDocument } from "@read-aware/plugin-types";
import { csvCell, definitionForExport, localDateStamp } from "./format";
import type { SavedWord } from "./types";

export function savedWordsCsv(saved: PluginDocument<SavedWord>[]): string {
  const rows = [
    [
      "Word",
      "Pronunciation",
      "Definition",
      "Etymology",
      "Contextual meaning",
      "Language",
      "Book",
      "Source context",
      "Added at",
    ],
    ...saved.map(({ data: word }) => [
      word.term,
      word.entry.pronunciation,
      definitionForExport(word.entry),
      word.entry.etymology,
      word.entry.contextualMeaning,
      word.language,
      word.bookTitle,
      word.context,
      word.addedAt,
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export async function exportSavedWords(
  ctx: PluginContext,
  saved: PluginDocument<SavedWord>[],
): Promise<{ toast: string } | undefined> {
  const exported = await ctx.ui.exportFile({
    filename: `readaware-dictionary-${localDateStamp(new Date())}.csv`,
    content: savedWordsCsv(saved),
    mimeType: "text/csv;charset=utf-8",
  });
  if (!exported) return undefined;

  return {
    toast: `Exported ${saved.length} saved ${saved.length === 1 ? "word" : "words"}`,
  };
}
