import { useState } from "react";
import { useSetAtom } from "jotai";
import {
  ArrowsClockwise,
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
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
import { useDictionaryLookup } from "../hooks/useDictionaryLookup";
import { DictionaryEntryBody } from "./DictionaryEntryBody";
import type { DictionaryEntry, SentenceExplanation } from "@read-aware/agent";
import {
  getDictionaryLanguage,
  resolveExplanationLanguageName,
  saveDictionaryLanguage,
  type DictionaryLanguage,
} from "../lib/dictionary-prefs";

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

/** Flatten a sentence explanation to plain text for the clipboard. */
function sentenceToText(
  sourceSentence: string,
  explanation: SentenceExplanation,
  labels: { note: string },
): string {
  const lines: string[] = [sourceSentence];
  if (explanation.translation) lines.push("", explanation.translation);
  if (explanation.glosses.length > 0) {
    lines.push("");
    explanation.glosses.forEach((gloss) => {
      const pronunciation = gloss.pronunciation ? ` ${gloss.pronunciation}` : "";
      lines.push(`• ${gloss.term}${pronunciation} — ${gloss.meaning}`);
    });
  }
  if (explanation.note) lines.push("", `${labels.note}: ${explanation.note}`);
  return lines.join("\n");
}

/**
 * AI-backed dictionary. Sends the selected text (plus its passage, for a
 * context-aware reading) to the *fast* model tier. A word or short phrase
 * renders a rich entry — detailed senses, examples, etymology, and what the
 * word means in this sentence; a whole sentence renders a translation plus
 * glosses for every word worth explaining (the lookup hook decides which).
 * Generated look-ups are cached (see the lookup hook); the card scrolls when
 * tall, with the headword, actions (regenerate / copy / save-to-vocabulary)
 * and a lightweight explanation-language picker pinned in the header. When no
 * AI provider is configured it shows an explicit connect-in-Settings state
 * (never mock content).
 */
export function ReaderDictionaryModal({
  open,
  word,
  context,
  bookTitle,
  onClose,
}: ReaderDictionaryModalProps) {
  const { t } = useTranslation(["reader", "common"]);
  const appLocale = useLocale();
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsSection = useSetAtom(settingsSectionRequestAtom);
  const [language, setLanguage] = useState<DictionaryLanguage>(() => getDictionaryLanguage());
  const [copied, setCopied] = useState(false);

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

  const result = state.status === "ready" ? state.result : null;
  const entry = result?.kind === "term" ? result.entry : null;
  const sentence = result?.kind === "sentence" ? result.explanation : null;
  const displayHead = entry?.headword?.trim() || term;
  const headword = displayHead.length > 48 ? `${displayHead.slice(0, 48)}…` : displayHead || "—";
  const hasBody = entry
    ? entry.senses.length > 0 || !!entry.etymology || !!entry.contextualMeaning
    : !!sentence && (!!sentence.translation || sentence.glosses.length > 0);
  const showActions = state.status === "ready" && hasBody;


  const setLang = (next: DictionaryLanguage) => {
    setLanguage(next);
    saveDictionaryLanguage(next);
  };

  const handleCopy = async () => {
    const text = entry
      ? entryToText(entry, {
          context: t("dictionary.contextLabel"),
          etymology: t("dictionary.etymologyLabel"),
        })
      : sentence
        ? sentenceToText(term, sentence, { note: t("dictionary.noteLabel") })
        : null;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable outside a trusted gesture.
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
          <div className="flex flex-col items-start gap-3 py-2">
            <Body className="text-sm leading-relaxed text-fg-muted">
              {t("dictionary.unconfigured")}
            </Body>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettingsSection("ai");
                setSettingsOpen(true);
              }}
            >
              {t("common:actions.openSettings")}
            </Button>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3 py-2">
            <Body className="text-sm leading-relaxed text-fg-muted">{t("dictionary.error")}</Body>
            {/* The underlying provider/parse error — generic copy alone made
                every failure look like a configuration problem. */}
            {state.message && (
              <Caption className="break-all font-mono text-fg-subtle">{state.message}</Caption>
            )}
            <Button variant="outline" size="sm" onClick={regenerate}>
              {t("dictionary.retry")}
            </Button>
          </div>
        )}

        {state.status === "ready" && !hasBody && (
          <Body className="py-2 text-sm leading-relaxed text-fg-muted">{t("dictionary.empty")}</Body>
        )}

        {showActions && sentence && (
          <DictionarySentenceBody explanation={sentence} />
        )}

        {showActions && entry && (
          <DictionaryEntryBody entry={entry} />
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

/**
 * The sentence-mode body: the whole-passage translation, then a gloss per word
 * worth explaining — each with its own save-to-vocabulary toggle (the sentence
 * itself is not a vocabulary item; its words are).
 */
function DictionarySentenceBody({
  explanation,
}: {
  explanation: SentenceExplanation;
}) {
  const { t } = useTranslation("reader");


  return (
    <div className="flex flex-col gap-4">
      {explanation.translation && (
        <div className="flex flex-col gap-1 rounded-md bg-fill p-3">
          <Eyebrow className="text-fg-subtle">{t("dictionary.translationLabel")}</Eyebrow>
          <Body className="text-sm leading-relaxed text-fg">{explanation.translation}</Body>
        </div>
      )}

      {explanation.glosses.length > 0 && (
        <div className="flex flex-col gap-1">
          <Eyebrow className="text-fg-subtle">{t("dictionary.glossesLabel")}</Eyebrow>
          <ul className="flex flex-col">
            {explanation.glosses.map((gloss, index) => {
              return (
                <li
                  key={index}
                  className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-serif text-sm font-medium text-fg">{gloss.term}</span>
                      {gloss.pronunciation && (
                        <span className="font-mono text-xs text-fg-subtle">
                          {gloss.pronunciation}
                        </span>
                      )}
                    </div>
                    <Body className="text-sm leading-relaxed text-fg-muted">{gloss.meaning}</Body>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {explanation.note && (
        <div className="flex flex-col gap-1">
          <Eyebrow className="text-fg-subtle">{t("dictionary.noteLabel")}</Eyebrow>
          <Body className="text-sm leading-relaxed text-fg-muted">{explanation.note}</Body>
        </div>
      )}
    </div>
  );
}
