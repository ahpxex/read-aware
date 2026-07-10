/**
 * A dictionary word card inside an assistant reply — self-contained (the full
 * entry travels with the message, whether it came from the vocabulary or a live
 * lookup). Collapsed: term + first definition, in the VocabularyPopover row
 * idiom. Expanded: pronunciation, senses with examples, contextual meaning,
 * etymology. The bookmark toggles vocabulary membership.
 */
import { useState } from "react";
import { BookmarkSimple, CaretRight } from "@phosphor-icons/react";
import { Eyebrow, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../../i18n";
import {
  addToVocabulary,
  isInVocabulary,
  removeFromVocabulary,
} from "../../../reader/lib/vocabulary";
import type { ChatWordReference } from "../../lib/chat-types";

export function WordReferenceCard({ reference }: { reference: ChatWordReference }) {
  const { t } = useTranslation("ai");
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(() => isInVocabulary(reference.term, reference.language));
  const { entry } = reference;
  const preview = entry.senses[0]?.definition ?? entry.contextualMeaning ?? "";

  const toggleSaved = () => {
    if (saved) {
      removeFromVocabulary(reference.term, reference.language);
    } else {
      addToVocabulary({ term: reference.term, language: reference.language, entry });
    }
    setSaved(!saved);
  };

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
        >
          <CaretRight
            size={11}
            weight="bold"
            aria-hidden="true"
            className={cn("shrink-0 text-fg-subtle transition-transform", expanded && "rotate-90")}
          />
          <span className="shrink-0 font-serif text-sm text-fg">{reference.term}</span>
          {!expanded && preview && (
            <span className="min-w-0 flex-1 truncate font-sans text-xs text-fg-subtle">
              {preview}
            </span>
          )}
        </button>
        <IconButton
          size="sm"
          label={saved ? t("chat.references.removeWord") : t("chat.references.saveWord")}
          onClick={toggleSaved}
          className="shrink-0 text-fg-subtle hover:text-fg"
          icon={<BookmarkSimple size={13} weight={saved ? "fill" : "regular"} />}
        />
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 px-2.5 pb-3 pl-[1.95rem] pr-3 text-xs">
          {entry.pronunciation && (
            <span className="font-mono text-fg-muted">{entry.pronunciation}</span>
          )}
          {entry.senses.map((sense, index) => (
            <div key={index} className="flex flex-col gap-0.5">
              {sense.partOfSpeech && (
                <span className="font-serif italic text-fg-muted">{sense.partOfSpeech}</span>
              )}
              <p className="leading-relaxed text-fg">{sense.definition}</p>
              {sense.examples.map((example, exampleIndex) => (
                <p
                  key={exampleIndex}
                  className="border-l-2 border-border pl-2 font-serif italic leading-relaxed text-fg-muted"
                >
                  {example}
                </p>
              ))}
            </div>
          ))}
          {entry.contextualMeaning && (
            <div className="flex flex-col gap-0.5 rounded-md bg-fill p-2">
              <Eyebrow className="text-fg-subtle">{t("context.vocabulary.contextLabel")}</Eyebrow>
              <p className="leading-relaxed text-fg">{entry.contextualMeaning}</p>
            </div>
          )}
          {entry.etymology && (
            <div className="flex flex-col gap-0.5">
              <Eyebrow className="text-fg-subtle">{t("context.vocabulary.etymologyLabel")}</Eyebrow>
              <p className="leading-relaxed text-fg-muted">{entry.etymology}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
