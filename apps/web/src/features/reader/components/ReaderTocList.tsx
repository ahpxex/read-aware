import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Body, IconButton, VirtualRows, type VirtualRow, type VirtualRowsHandle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useTocOutline } from "../hooks/useTocOutline";
import type { TocEntry } from "../lib/reader-types";

/** A contents row label's type (Body's own line height); its toggle slot
 * shares it to align with the first line. */
export const TOC_LABEL_TYPE = "text-sm";

/**
 * The book's foldable table of contents. Windowed: a set's contents can run
 * to tens of thousands of entries.
 */
export function ReaderTocList({
  bookId,
  entries,
  activeIndex,
  revealing,
  onSelect,
}: {
  bookId: string;
  entries: TocEntry[];
  /** The current chapter's index into `entries`, or -1. */
  activeIndex: number;
  /** The list is on screen: reveal the current chapter when this turns on. */
  revealing: boolean;
  onSelect: (href: string) => void;
}) {
  const { t } = useTranslation("reader");
  const rowsRef = useRef<VirtualRowsHandle | null>(null);
  const outline = useTocOutline(bookId, entries, activeIndex);

  // Reveal the current chapter when the list comes on screen (or the chapter
  // changes while it is), centered so it's easy to find. The current row may
  // not be mounted, so scroll by index. Folding a branch shifts the current
  // row's index but must not scroll.
  const revealCurrentRow = useEffectEvent(() => {
    if (outline.currentRow >= 0) rowsRef.current?.scrollToIndex(outline.currentRow, "center");
  });
  useEffect(() => {
    if (!revealing || activeIndex < 0) return;
    const frame = window.requestAnimationFrame(() => revealCurrentRow());
    return () => window.cancelAnimationFrame(frame);
  }, [revealing, activeIndex]);

  // Rows are rebuilt only when the outline or the current chapter change; the
  // click handler reads the latest callback through a ref.
  const select = useRef(onSelect);
  useLayoutEffect(() => {
    select.current = onSelect;
  });
  const { rows: outlineRows, currentRow, toggle } = outline;
  const rows = useMemo<VirtualRow[]>(
    () =>
      outlineRows.map(({ index, entry, branch, open }, row) => {
        // A single resolved index (fragment-aware) — per-entry loose
        // matching lit up every chapter sharing the current spine file.
        const isActive = index === activeIndex;
        // A folded branch holding the current chapter stands in for it.
        const marksCurrent = row === currentRow;
        const toggleLabel = t(open ? "tocCollapse" : "tocExpand", { label: entry.label });
        return {
          key: entry.id,
          // One line of Body's line height (2rem) plus the row's vertical padding.
          size: 44,
          content: (
            <div className="relative">
              {branch && (
                // Sits in the row's inset, just before the label, so folding
                // adds no indentation and leaves every label where it was.
                // The slot takes the label's own type (same component and
                // classes, so the same line height) and the button's top
                // padding: the toggle centres on the label's first line
                // whatever that line height resolves to.
                <Body
                  as="span"
                  className={cn("absolute top-1.5 z-[1] flex h-lh items-center", TOC_LABEL_TYPE)}
                  style={{ left: `${entry.depth * 0.85}rem` }}
                >
                  <IconButton
                    size="sm"
                    label={toggleLabel}
                    aria-expanded={open}
                    icon={
                      <CaretRight
                        size={14}
                        weight="bold"
                        className={cn(
                          "transition-transform duration-150 motion-reduce:transition-none",
                          open && "rotate-90",
                        )}
                      />
                    }
                    onClick={() => toggle(index)}
                  />
                </Body>
              )}
              {/* oxlint-disable-next-line react/forbid-elements -- table-of-contents entry row with depth indentation and aria-current */}
              <button
                type="button"
                onClick={() => select.current(entry.href)}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "w-full border-l-2 py-1.5 pr-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                  marksCurrent ? "border-fg bg-fill text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
                // The row's own inset, so the text sits clear of the toggle
                // while the row runs edge to edge. Nesting adds to it.
                style={{ paddingLeft: `${1.75 + entry.depth * 0.85}rem` }}
              >
                <Body
                  as="span"
                  className={cn(
                    "block min-w-0",
                    TOC_LABEL_TYPE,
                    marksCurrent ? "font-semibold text-fg" : "text-inherit",
                  )}
                >
                  {entry.label}
                </Body>
              </button>
            </div>
          ),
        };
      }),
    [outlineRows, currentRow, toggle, activeIndex, t],
  );

  if (entries.length === 0) return <Body className="px-5 py-2 text-sm text-fg-muted">{t("noToc")}</Body>;
  return <VirtualRows ref={rowsRef} rows={rows} />;
}
