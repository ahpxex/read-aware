import { Body, Caption, Dialog, Divider, Eyebrow, Heading } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

type ReaderDictionaryModalProps = {
  open: boolean;
  word: string;
  onClose: () => void;
};

/**
 * Placeholder dictionary. A real lookup (definitions, etymology, on-device or
 * via a provider) is not wired up yet — this shows the selected term in a proper
 * dictionary layout so the entry point and surface exist. Mock content only.
 */
export function ReaderDictionaryModal({ open, word, onClose }: ReaderDictionaryModalProps) {
  const { t } = useTranslation("reader");
  // Trim surrounding quotes/brackets/trailing punctuation so a word picked out
  // of dialogue ("“pig,”") reads as a clean headword.
  const cleaned = word
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[“”"'‘’«»(\[{]+|[“”"'‘’«»)\]}.,;:!?…]+$/gu, "");
  const term = cleaned || word.trim();
  const headword = term.length > 48 ? `${term.slice(0, 48)}…` : term || "—";
  const firstWord = (term.split(" ")[0] || "word").toLowerCase();

  const senses = [
    { id: "noun", pos: t("dictionary.pos.noun"), gloss: t("dictionary.senseNoun", { word: firstWord }) },
    { id: "verb", pos: t("dictionary.pos.verb"), gloss: t("dictionary.senseVerb", { word: firstWord }) },
  ];

  return (
    <Dialog open={open} onClose={onClose} aria-label={t("dictionary.title")}>
      <div className="flex w-[min(90vw,27rem)] flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <Eyebrow className="text-fg-subtle">{t("dictionary.title")}</Eyebrow>
          <Heading as="h2" size="2xl" className="font-serif leading-tight">
            {headword}
          </Heading>
          <span className="font-mono text-sm text-fg-muted">/ˈ{firstWord}/</span>
        </div>

        <Divider />

        <div className="flex flex-col gap-4">
          {senses.map((sense, index) => (
            <div key={sense.id} className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs tabular-nums text-fg-subtle">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-serif text-sm italic text-fg-muted">{sense.pos}</span>
                <Body className="text-sm leading-relaxed text-fg">{sense.gloss}</Body>
              </div>
            </div>
          ))}
        </div>

        <Divider />

        <Caption className="text-fg-subtle">
          {t("dictionary.footer")}
        </Caption>
      </div>
    </Dialog>
  );
}
