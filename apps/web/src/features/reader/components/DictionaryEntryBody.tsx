/**
 * The canonical rendering of a DictionaryEntry — extracted from
 * ReaderDictionaryModal so every surface showing a dictionary entry (the
 * reader's modal, plugin dictionary blocks) is the same editorial UX:
 * numbered senses with part-of-speech, example quotes, contextual meaning,
 * etymology.
 */
import type { DictionaryEntry } from "@read-aware/agent";
import { Body, Eyebrow } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

export function DictionaryEntryBody({ entry }: { entry: DictionaryEntry }) {
  const { t } = useTranslation("reader");
  return (
    <div className="flex flex-col gap-4">
      {entry.senses.map((sense, index) => (
        <div key={index} className="flex gap-3">
          <span className="mt-0.5 font-mono text-xs tabular-nums text-fg-subtle">
            {index + 1}
          </span>
          <div className="flex flex-col gap-1.5">
            {sense.partOfSpeech && (
              <span className="font-serif text-sm italic text-fg-muted">
                {sense.partOfSpeech}
              </span>
            )}
            <Body className="text-sm leading-relaxed text-fg">{sense.definition}</Body>
            {sense.examples.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-1">
                {sense.examples.map((example, exampleIndex) => (
                  <li
                    key={exampleIndex}
                    className="border-l-2 border-border pl-2 font-serif text-sm italic leading-relaxed text-fg-muted"
                  >
                    {example}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}

      {entry.contextualMeaning && (
        <div className="flex flex-col gap-1 rounded-md bg-fill p-3">
          <Eyebrow className="text-fg-subtle">{t("dictionary.contextLabel")}</Eyebrow>
          <Body className="text-sm leading-relaxed text-fg">{entry.contextualMeaning}</Body>
        </div>
      )}

      {entry.etymology && (
        <div className="flex flex-col gap-1">
          <Eyebrow className="text-fg-subtle">{t("dictionary.etymologyLabel")}</Eyebrow>
          <Body className="text-sm leading-relaxed text-fg-muted">{entry.etymology}</Body>
        </div>
      )}
    </div>
  );
}
