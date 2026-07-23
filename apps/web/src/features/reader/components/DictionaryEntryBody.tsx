/**
 * The canonical rendering of a DictionaryEntry — extracted from
 * ReaderDictionaryModal so every surface showing a dictionary entry (the
 * reader's modal, plugin dictionary blocks) is the same editorial UX:
 * numbered senses with part-of-speech, example quotes, contextual meaning,
 * etymology.
 */
import { Fragment, type ReactNode } from "react";
import type { DictionaryEntry } from "@read-aware/agent";
import { Body, Caption, Eyebrow, Heading, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

/**
 * Inline emphasis only — the model salts dictionary prose (especially
 * etymology and word forms) with `*italic*` / `**bold**`; left as plain text
 * the asterisks leak on screen. This renders that emphasis without pulling the
 * full block-Markdown pipeline into an editorial one-liner.
 */
function inlineEmphasis(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let key = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] != null) parts.push(<strong key={key++}>{match[1]}</strong>);
    else parts.push(<em key={key++}>{match[2] ?? match[3]}</em>);
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

export function DictionaryEntryHeading({
  headword,
  pronunciation,
}: {
  headword: string;
  pronunciation?: string;
}) {
  return (
    <Stack gap="xs" className="min-w-0">
      <Heading as="h2" size="2xl" className="font-serif leading-tight">
        {headword}
      </Heading>
      {pronunciation && (
        <Caption className="font-mono text-sm text-fg-muted">{pronunciation}</Caption>
      )}
    </Stack>
  );
}

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
            <Body className="text-sm leading-relaxed text-fg">
              {inlineEmphasis(sense.definition)}
            </Body>
            {sense.examples.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-1">
                {sense.examples.map((example, exampleIndex) => (
                  <li
                    key={exampleIndex}
                    className="border-l-2 border-border pl-2 font-serif text-sm italic leading-relaxed text-fg-muted"
                  >
                    {inlineEmphasis(example)}
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
          <Body className="text-sm leading-relaxed text-fg">
            {inlineEmphasis(entry.contextualMeaning)}
          </Body>
        </div>
      )}

      {entry.etymology && (
        <div className="flex flex-col gap-1">
          <Eyebrow className="text-fg-subtle">{t("dictionary.etymologyLabel")}</Eyebrow>
          <Body className="text-sm leading-relaxed text-fg-muted">
            {inlineEmphasis(entry.etymology)}
          </Body>
        </div>
      )}
    </div>
  );
}
