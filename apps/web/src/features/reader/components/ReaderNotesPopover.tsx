import { useState } from "react";
import { Notebook } from "@phosphor-icons/react";
import { Body, Eyebrow, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatNumber, useTranslation } from "../../../i18n";
import { AnnotationRow } from "../../annotations/components/AnnotationRow";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { normalizeHref } from "../lib/epub-utils";
import type { TocEntry } from "../lib/reader-types";

type ReaderNotesPopoverProps = {
  annotations: Annotation[];
  tocEntries: TocEntry[];
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
};

// Mirrors the header icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg";

type Group = { label: string | null; items: Annotation[] };

/** Order annotations by their chapter's position in the TOC; anything that
 *  doesn't map to a chapter falls into a trailing unlabeled group. */
function groupByTocOrder(annotations: Annotation[], tocEntries: TocEntry[]): Group[] {
  const groups: Group[] = [];
  const claimed = new Set<string>();
  for (const entry of tocEntries) {
    const key = normalizeHref(entry.href);
    const items = annotations.filter(
      (a) => a.chapterHref && normalizeHref(a.chapterHref) === key && !claimed.has(a.id),
    );
    if (items.length === 0) continue;
    items.forEach((a) => claimed.add(a.id));
    groups.push({ label: entry.label, items });
  }
  const rest = annotations.filter((a) => !claimed.has(a.id));
  if (rest.length > 0) groups.push({ label: null, items: rest });
  return groups;
}

/**
 * The book's highlights and notes, opened from a header icon. Grouped by chapter
 * (in reading order); selecting one navigates to it and closes the popover.
 * Lives in the header so the right-hand panel can stay dedicated to chat.
 */
export function ReaderNotesPopover({
  annotations,
  tocEntries,
  onNavigate,
  onDelete,
}: ReaderNotesPopoverProps) {
  const { t } = useTranslation("reader");
  const [open, setOpen] = useState(false);
  const groups = groupByTocOrder(annotations, tocEntries);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="left"
      className="pointer-events-auto"
      triggerLabel={t("notes")}
      triggerTooltip={t("notes")}
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={
        <Notebook size={18} weight={open ? "bold" : "regular"} aria-hidden="true" />
      }
      panelClassName="flex max-h-[min(28rem,70vh)] w-[clamp(18rem,28vw,26rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <Eyebrow as="span">{t("notes")}</Eyebrow>
        <span className="text-xs tabular-nums text-fg-subtle">
          {formatNumber(annotations.length)}
        </span>
      </div>

      {annotations.length === 0 ? (
        <div className="px-4 py-8">
          <Body className="text-center text-sm text-fg-muted">
            {t("emptyNotes")}
          </Body>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-3 py-3">
            {groups.map((group, index) => (
              <div key={group.label ?? `__rest__${index}`}>
                {group.label && (
                  <p className="mb-1 px-2 font-sans text-[13px] font-medium text-fg-subtle">
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-1">
                  {group.items.map((annotation) => (
                    <AnnotationRow
                      key={annotation.id}
                      annotation={annotation}
                      onNavigate={(cfiRange) => {
                        onNavigate(cfiRange);
                        setOpen(false);
                      }}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
