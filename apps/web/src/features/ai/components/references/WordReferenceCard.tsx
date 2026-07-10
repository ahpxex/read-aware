/**
 * A dictionary word card inside an assistant reply — self-contained (the full
 * entry travels with the message, whether it came from the vocabulary or a live
 * lookup) and always fully open: the entry IS the reply, so there is nothing to
 * collapse. Reads like a dictionary entry — headword line with the
 * pronunciation, senses with quiet indented examples, then hairline-separated
 * context and origin sections. The bookmark toggles vocabulary membership.
 */
import { useState } from "react";
import { BookmarkSimple } from "@phosphor-icons/react";
import { Eyebrow, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../../i18n";
import {
  addToVocabulary,
  isInVocabulary,
  removeFromVocabulary,
} from "../../../reader/lib/vocabulary";
import type { ChatWordReference } from "../../lib/chat-types";

export function WordReferenceCard({ reference }: { reference: ChatWordReference }) {
  const { t } = useTranslation("ai");
  const [saved, setSaved] = useState(() => isInVocabulary(reference.term, reference.language));
  const { entry } = reference;
  const numbered = entry.senses.length > 1;

  const toggleSaved = () => {
    if (saved) {
      removeFromVocabulary(reference.term, reference.language);
    } else {
      addToVocabulary({ term: reference.term, language: reference.language, entry });
    }
    setSaved(!saved);
  };

  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="font-serif text-base font-medium text-fg">{reference.term}</span>
          {entry.pronunciation && (
            <span className="min-w-0 truncate text-xs text-fg-subtle">{entry.pronunciation}</span>
          )}
        </div>
        <IconButton
          size="sm"
          label={saved ? t("chat.references.removeWord") : t("chat.references.saveWord")}
          onClick={toggleSaved}
          className="-mr-1 shrink-0 text-fg-subtle hover:text-fg"
          icon={<BookmarkSimple size={13} weight={saved ? "fill" : "regular"} />}
        />
      </div>

      <div className="mt-1.5 flex flex-col gap-2 text-xs">
        {entry.senses.map((sense, index) => (
          <div key={index} className="flex flex-col gap-1">
            <p className="leading-relaxed text-fg">
              {numbered && <span className="text-fg-subtle">{index + 1}&ensp;</span>}
              {sense.partOfSpeech && (
                <span className="font-serif italic text-fg-muted">{sense.partOfSpeech} · </span>
              )}
              {sense.definition}
            </p>
            {sense.examples.map((example, exampleIndex) => (
              <p
                key={exampleIndex}
                className="pl-3 font-serif italic leading-relaxed text-fg-subtle"
              >
                {example}
              </p>
            ))}
          </div>
        ))}
        {entry.contextualMeaning && (
          <div className="flex flex-col gap-0.5 border-t border-border pt-2">
            <Eyebrow className="text-fg-subtle">{t("context.vocabulary.contextLabel")}</Eyebrow>
            <p className="leading-relaxed text-fg">{entry.contextualMeaning}</p>
          </div>
        )}
        {entry.etymology && (
          <div className="flex flex-col gap-0.5 border-t border-border pt-2">
            <Eyebrow className="text-fg-subtle">{t("context.vocabulary.etymologyLabel")}</Eyebrow>
            <p className="leading-relaxed text-fg-muted">{entry.etymology}</p>
          </div>
        )}
      </div>
    </div>
  );
}
