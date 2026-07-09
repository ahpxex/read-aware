import { useEffect, useState } from "react";
import {
  ArrowsClockwise,
  BookmarkSimple,
  CaretDown,
  Check,
  Copy,
  Translate,
} from "@phosphor-icons/react";
import {
  Body,
  Button,
  Caption,
  Dialog,
  Divider,
  DropdownMenu,
  Eyebrow,
  Heading,
  IconButton,
  Spinner,
} from "@read-aware/ui";
import { LOCALE_LABELS, LOCALES, useLocale, useTranslation } from "../../../i18n";
import { useDictionaryLookup } from "../hooks/useDictionaryLookup";
import type { DictionaryEntry } from "@read-aware/agent";
import {
  getDictionaryLanguage,
  resolveExplanationLanguageName,
  saveDictionaryLanguage,
  type DictionaryLanguage,
} from "../lib/dictionary-prefs";
import {
  addToVocabulary,
  isInVocabulary,
  removeFromVocabulary,
} from "../lib/vocabulary";

type ReaderDictionaryModalProps = {
  open: boolean;
  word: string;
  /** The sentence/passage the word was picked from, for a contextual reading. */
  context?: string;
  bookTitle?: string;
  onClose: () => void;
};

/** Flatten an entry to plain text for the clipboard. */
function entryToText(
  entry: DictionaryEntry,
  labels: { context: string; etymology: string },
): string {
  const lines: string[] = [];
  lines.push(entry.pronunciation ? `${entry.headword}  ${entry.pronunciation}` : entry.headword);
  entry.senses.forEach((sense, index) => {
    const pos = sense.partOfSpeech ? `(${sense.partOfSpeech}) ` : "";
    lines.push(`${index + 1}. ${pos}${sense.definition}`);
    sense.examples.forEach((example) => lines.push(`   • ${example}`));
  });
  if (entry.contextualMeaning) lines.push(`\n${labels.context}: ${entry.contextualMeaning}`);
  if (entry.etymology) lines.push(`\n${labels.etymology}: ${entry.etymology}`);
  return lines.join("\n");
}

/**
 * AI-backed dictionary. Sends the selected term (plus its passage, for a
 * context-aware reading) to the *fast* model tier and renders a rich entry —
 * detailed senses, examples, etymology, and what the word means in this
 * sentence. Generated entries are cached (see the lookup hook); the card
 * scrolls when tall, with the headword, actions (regenerate / copy /
 * save-to-vocabulary) and a lightweight explanation-language picker pinned in
 * the header. When no AI provider is configured it shows an explicit
 * connect-in-Settings state (never mock content).
 */
export function ReaderDictionaryModal({
  open,
  word,
  context,
  bookTitle,
  onClose,
}: ReaderDictionaryModalProps) {
  const { t } = useTranslation("reader");
  const appLocale = useLocale();
  const [language, setLanguage] = useState<DictionaryLanguage>(() => getDictionaryLanguage());
  const [copied, setCopied] = useState(false);
  const [inVocab, setInVocab] = useState(false);

  // Trim surrounding quotes/brackets/trailing punctuation so a word picked out
  // of dialogue ("“pig,”") reads as a clean headword while the lookup runs.
  const cleaned = word
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[“”"'‘’«»(\[{]+|[“”"'‘’«»)\]}.,;:!?…]+$/gu, "");
  const term = cleaned || word.trim();

  const explanationLanguage = resolveExplanationLanguageName(language, appLocale);
  const { state, regenerate } = useDictionaryLookup({
    open,
    term,
    context,
    bookTitle,
    explanationLanguage,
  });

  const entry = state.status === "ready" ? state.entry : null;
  const displayHead = entry?.headword?.trim() || term;
  const headword = displayHead.length > 48 ? `${displayHead.slice(0, 48)}…` : displayHead || "—";
  const hasBody =
    !!entry && (entry.senses.length > 0 || !!entry.etymology || !!entry.contextualMeaning);
  const showActions = state.status === "ready" && hasBody;

  // Keep the "in vocabulary" toggle in sync with what's saved for this term.
  useEffect(() => {
    setInVocab(entry ? isInVocabulary(term, explanationLanguage) : false);
  }, [entry, term, explanationLanguage]);

  const setLang = (next: DictionaryLanguage) => {
    setLanguage(next);
    saveDictionaryLanguage(next);
  };

  const handleCopy = async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(
        entryToText(entry, {
          context: t("dictionary.contextLabel"),
          etymology: t("dictionary.etymologyLabel"),
        }),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable outside a trusted gesture.
    }
  };

  const handleToggleVocab = () => {
    if (!entry) return;
    if (inVocab) {
      removeFromVocabulary(term, explanationLanguage);
      setInVocab(false);
    } else {
      addToVocabulary({ term, language: explanationLanguage, entry, context, bookTitle });
      setInVocab(true);
    }
  };

  const currentLangLabel =
    language === "auto" ? t("dictionary.languageAuto") : LOCALE_LABELS[language];
  const languageItems = [
    { value: "auto" as DictionaryLanguage, label: t("dictionary.languageAuto") },
    ...LOCALES.map((locale) => ({ value: locale as DictionaryLanguage, label: LOCALE_LABELS[locale] })),
  ].map((option) => ({
    label: option.label,
    icon:
      option.value === language ? (
        <Check size={14} />
      ) : (
        <span className="inline-block w-[14px]" aria-hidden />
      ),
    onClick: () => setLang(option.value),
  }));

  const surface = "bg-[var(--ra-main-surface-color)]";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label={t("dictionary.title")}
      className="max-h-[85vh] w-[min(90vw,28rem)] overflow-y-auto overscroll-none p-0"
    >
      {/* Sticky header keeps the headword, actions and language picker in view
          while the entry scrolls. The panel itself is the scroll container
          (overflow-y-auto above), so sticky positions against it through the
          Dialog's content wrapper. */}
      <div className={`sticky top-0 z-10 border-b border-border px-6 pb-4 pt-5 ${surface}`}>
        <div className="flex items-center justify-between gap-2">
          <Eyebrow className="text-fg-subtle">{t("dictionary.title")}</Eyebrow>
          <DropdownMenu
            align="right"
            trigger={
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-subtle transition-colors hover:text-fg">
                <Translate size={14} />
                {currentLangLabel}
                <CaretDown size={10} />
              </span>
            }
            items={languageItems}
          />
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Heading as="h2" size="2xl" className="font-serif leading-tight">
              {headword}
            </Heading>
            {entry?.pronunciation && (
              <span className="mt-1 block font-mono text-sm text-fg-muted">
                {entry.pronunciation}
              </span>
            )}
          </div>
          {showActions && (
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                size="sm"
                icon={<ArrowsClockwise size={17} />}
                label={t("dictionary.regenerate")}
                onClick={regenerate}
              />
              <IconButton
                size="sm"
                icon={copied ? <Check size={17} /> : <Copy size={17} />}
                label={copied ? t("dictionary.copied") : t("dictionary.copy")}
                onClick={handleCopy}
              />
              <IconButton
                size="sm"
                icon={<BookmarkSimple size={17} weight={inVocab ? "fill" : "regular"} />}
                label={inVocab ? t("dictionary.inVocab") : t("dictionary.addToVocab")}
                onClick={handleToggleVocab}
              />
            </div>
          )}
        </div>
      </div>

      {/* Body — scrolls within the panel. */}
      <div className="px-6 py-4">
        {state.status === "loading" && (
          <div className="flex items-center gap-3 py-4">
            <Spinner size="sm" />
            <Body className="text-sm text-fg-muted">{t("dictionary.loading")}</Body>
          </div>
        )}

        {state.status === "unconfigured" && (
          <Body className="py-2 text-sm leading-relaxed text-fg-muted">
            {t("dictionary.unconfigured")}
          </Body>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3 py-2">
            <Body className="text-sm leading-relaxed text-fg-muted">{t("dictionary.error")}</Body>
            <Button variant="outline" size="sm" onClick={regenerate}>
              {t("dictionary.retry")}
            </Button>
          </div>
        )}

        {state.status === "ready" && !hasBody && (
          <Body className="py-2 text-sm leading-relaxed text-fg-muted">{t("dictionary.empty")}</Body>
        )}

        {showActions && (
          <div className="flex flex-col gap-4">
            {entry?.senses.map((sense, index) => (
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

            {entry?.contextualMeaning && (
              <div className="flex flex-col gap-1 rounded-md bg-fill p-3">
                <Eyebrow className="text-fg-subtle">{t("dictionary.contextLabel")}</Eyebrow>
                <Body className="text-sm leading-relaxed text-fg">{entry.contextualMeaning}</Body>
              </div>
            )}

            {entry?.etymology && (
              <div className="flex flex-col gap-1">
                <Eyebrow className="text-fg-subtle">{t("dictionary.etymologyLabel")}</Eyebrow>
                <Body className="text-sm leading-relaxed text-fg-muted">{entry.etymology}</Body>
              </div>
            )}
          </div>
        )}

        {showActions && (
          <>
            <Divider className="my-4" />
            <Caption className="text-fg-subtle">{t("dictionary.footer")}</Caption>
          </>
        )}
      </div>
    </Dialog>
  );
}
