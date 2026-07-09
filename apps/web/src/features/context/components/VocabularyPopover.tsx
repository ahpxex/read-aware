/**
 * Saved-words browser, shown as an AppHeader icon popover on the Context
 * (global agent) surface — same interaction and row style as ThreadsPopover /
 * AnnotationsPopover. Reads the device-local vocabulary store; rows expand to
 * reveal the full saved entry (senses, examples, context, etymology) and carry
 * a hover-reveal delete. Deliberately lightweight — no resident sidebar; the
 * list is re-read on every open (the store is synchronous localKV).
 */
import { useEffect, useState } from "react";
import { CaretRight, Cards, Trash } from "@phosphor-icons/react";
import { Body, Eyebrow, IconButton, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  getVocabulary,
  removeFromVocabulary,
  type VocabularyItem,
} from "../../reader/lib/vocabulary";

// Mirrors the AppHeader icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

export function VocabularyPopover() {
  const { t } = useTranslation("ai");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Re-read on every open — words accrue as the reader saves them.
  useEffect(() => {
    if (open) {
      setItems([...getVocabulary()].sort((a, b) => b.addedAt - a.addedAt));
      setExpandedId(null);
    }
  }, [open]);

  const remove = (item: VocabularyItem) => {
    removeFromVocabulary(item.term, item.language);
    setItems((prev) => prev.filter((entry) => entry.id !== item.id));
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={t("context.vocabulary.title")}
      triggerTooltip={t("context.vocabulary.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={<Cards size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />}
      panelClassName="flex max-h-[min(28rem,64vh)] w-[clamp(17rem,26vw,24rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pl-4 pr-3">
        <Eyebrow as="span">{t("context.vocabulary.title")}</Eyebrow>
        {items.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-fg-subtle">{items.length}</span>
        )}
      </div>

      {items.length === 0 ? (
        <Body className="px-4 py-6 text-xs leading-relaxed text-fg-muted">
          {t("context.vocabulary.empty")}
        </Body>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
          <div className="flex flex-col gap-0.5 px-2 py-2">
            {items.map((item) => (
              <VocabularyRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                onDelete={() => remove(item)}
                deleteLabel={t("context.vocabulary.remove")}
                contextLabel={t("context.vocabulary.contextLabel")}
                etymologyLabel={t("context.vocabulary.etymologyLabel")}
              />
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

function VocabularyRow({
  item,
  expanded,
  onToggle,
  onDelete,
  deleteLabel,
  contextLabel,
  etymologyLabel,
}: {
  item: VocabularyItem;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleteLabel: string;
  contextLabel: string;
  etymologyLabel: string;
}) {
  const preview = item.entry.senses[0]?.definition ?? "";

  return (
    <div className="rounded-md transition-colors hover:bg-fill">
      <div className="group flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
        >
          <CaretRight
            size={11}
            weight="bold"
            aria-hidden="true"
            className={cn(
              "shrink-0 text-fg-subtle transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="shrink-0 font-serif text-sm text-fg">{item.term}</span>
          {!expanded && preview && (
            <span className="min-w-0 flex-1 truncate font-sans text-xs text-fg-subtle">
              {preview}
            </span>
          )}
        </button>
        <IconButton
          size="sm"
          label={deleteLabel}
          onClick={onDelete}
          className="shrink-0 text-fg-subtle opacity-0 hover:text-red-600 group-hover:opacity-100 pointer-coarse:opacity-100"
          icon={<Trash size={12} weight="regular" />}
        />
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 px-2 pb-3 pl-[1.85rem] pr-3 text-xs">
          {item.entry.pronunciation && (
            <span className="font-mono text-fg-muted">{item.entry.pronunciation}</span>
          )}
          {item.entry.senses.map((sense, index) => (
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
          {item.entry.contextualMeaning && (
            <div className="flex flex-col gap-0.5 rounded-md bg-fill p-2">
              <Eyebrow className="text-fg-subtle">{contextLabel}</Eyebrow>
              <p className="leading-relaxed text-fg">{item.entry.contextualMeaning}</p>
            </div>
          )}
          {item.entry.etymology && (
            <div className="flex flex-col gap-0.5">
              <Eyebrow className="text-fg-subtle">{etymologyLabel}</Eyebrow>
              <p className="leading-relaxed text-fg-muted">{item.entry.etymology}</p>
            </div>
          )}
          {item.bookTitle && (
            <p className="font-serif italic text-fg-subtle">— {item.bookTitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
