import type { PluginDictionaryEntry } from "@read-aware/plugin-types";

/** Term + explanation language, lowercased: the saved-word dedupe identity. */
export function idFor(term: string, language: string): string {
  return `${language} ${term.trim().toLowerCase()}`;
}

/** One-line rendering of the first sense, part-of-speech prefixed. */
export function definitionOf(entry: PluginDictionaryEntry): string {
  const first = entry.senses?.[0];
  if (!first) return entry.contextualMeaning ?? "";
  return first.partOfSpeech ? `(${first.partOfSpeech}) ${first.definition}` : first.definition;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function definitionForExport(entry: PluginDictionaryEntry): string {
  return (entry.senses ?? [])
    .map((sense) =>
      [
        sense.partOfSpeech
          ? `${sense.partOfSpeech}: ${sense.definition}`
          : sense.definition,
        ...(sense.examples ?? []).map((example) => `Example: ${example}`),
      ].join("\n"),
    )
    .join("\n\n");
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function localDateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
