import { useEffect, useState } from "react";
import { CaretLeft, ListBullets, Notebook } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { Body, IconButton, ScrollArea } from "@read-aware/ui";
import { AnnotationsPanel } from "../../annotations/components/AnnotationsPanel";
import { hrefMatches } from "../lib/epub-utils";
import type { TocEntry } from "../lib/reader-types";
import { ReaderAppearanceMenu } from "./ReaderAppearanceMenu";

type ReaderShellOverlayProps = {
  visible: boolean;
  onBack: () => void;
  bookId: string;
  title?: string;
  progress?: number;
  currentPage?: number;
  totalPages?: number;
  tocEntries?: TocEntry[];
  currentChapterHref?: string | null;
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
};

export function ReaderShellOverlay({
  visible,
  onBack,
  bookId,
  title,
  progress,
  currentPage,
  totalPages,
  tocEntries = [],
  currentChapterHref = null,
  onChapterSelect,
  onAnnotationSelect,
}: ReaderShellOverlayProps) {
  const percent =
    progress != null ? Math.min(100, Math.max(0, progress * 100)) : null;
  const roundedPercent = percent != null ? Math.round(percent) : null;
  const hasPages = totalPages != null && totalPages > 0;
  const progressLabel =
    roundedPercent != null
      ? hasPages
        ? `${currentPage ?? 0} / ${totalPages} · ${roundedPercent}%`
        : `${roundedPercent}%`
      : null;

  const [tocOpen, setTocOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // The appearance popup is transient — it closes whenever the overlay is
  // dismissed. The contents and notes panels are NOT reset: they keep their open
  // state so dismissing then re-opening the header restores whatever the reader
  // had revealed. (Reset state lives in the panels' `visible &&` reveal gate.)
  useEffect(() => {
    if (!visible) setAppearanceOpen(false);
  }, [visible]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden",
      )}
    >
      {/* Top bar — doubles as the window drag region on desktop. Non-interactive
          children stay pointer-events-none so a drag started anywhere but the
          buttons falls through to this element; the buttons re-enable clicks.
          Left padding clears the macOS traffic lights when present. */}
      <div
        data-tauri-drag-region="deep"
        style={{
          // Symmetric horizontal inset: the left must clear the macOS traffic
          // lights, so mirror that clearance on the right to keep the two icon
          // clusters equidistant from their edges.
          paddingLeft: "max(1.25rem, var(--ra-traffic-light-inset))",
          paddingRight: "max(1.25rem, var(--ra-traffic-light-inset))",
        }}
        className={cn(
          "pointer-events-auto relative shrink-0 bg-fill py-3 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="pointer-events-none flex items-center gap-3">
          {/* Left cluster: back to shelf + contents toggle */}
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="sm"
              label="Back to shelf"
              title="Shelf"
              onClick={onBack}
              className="pointer-events-auto"
              icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
            />
            <IconButton
              size="sm"
              label="Table of contents"
              title="Contents"
              aria-pressed={tocOpen}
              onClick={() => setTocOpen((open) => !open)}
              className={cn("pointer-events-auto", tocOpen && "text-fg")}
              icon={
                <ListBullets
                  size={18}
                  weight={tocOpen ? "bold" : "regular"}
                  aria-hidden="true"
                />
              }
            />
          </div>

          {/* Center: title (prominent) with a small progress readout beneath. */}
          {title && (
            <div className="min-w-0 flex-1 px-2 text-center">
              <Body className="truncate text-[15px] font-semibold leading-tight text-fg">
                {title}
              </Body>
              {/* Arbitrary px size: tailwind-merge would strip a custom
                  `text-*` size token when a `text-*` color is also present. */}
              {progressLabel && (
                <span className="mt-0.5 block truncate font-sans text-[11px] leading-none tabular-nums text-fg-subtle">
                  {progressLabel}
                </span>
              )}
            </div>
          )}

          {/* Right cluster: appearance + notes */}
          <div className="flex shrink-0 items-center justify-end gap-0.5">
            <ReaderAppearanceMenu
              bookId={bookId}
              open={appearanceOpen}
              onOpenChange={setAppearanceOpen}
            />
            <IconButton
              size="sm"
              label="Notes"
              title="Notes"
              aria-pressed={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
              className={cn("pointer-events-auto", notesOpen && "text-fg")}
              icon={
                <Notebook
                  size={18}
                  weight={notesOpen ? "bold" : "regular"}
                  aria-hidden="true"
                />
              }
            />
          </div>
        </div>

        {/* Reading progress, merged into the header's bottom edge. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-border/70">
          {percent != null && (
            <div
              className="h-full bg-fg-subtle transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
      </div>

      {/* Middle zone -- panels dock to the edges while the reader shows through.
          The panels stay mounted and preserve their open state; `visible` only
          gates whether they are revealed, so dismissing then re-opening the
          header restores whatever was showing (and avoids a re-fetch flash). */}
      <div className="pointer-events-none flex min-h-0 flex-1 items-stretch justify-between">
        {/* Table of contents (left) */}
        <section
          aria-label="Table of contents"
          className={cn(
            "flex h-full min-h-0 w-[clamp(16rem,24vw,30rem)] flex-col border-r border-border-strong/70 backdrop-blur-sm transition-all duration-200 ease-out",
            visible && tocOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "-translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--ra-main-surface-color) 84%, transparent)",
          }}
        >
          <ScrollArea className="h-full min-h-0 flex-1">
            <div className="flex flex-col px-3 py-4">
              {tocEntries.length === 0 && (
                <Body className="px-2 py-2 text-sm text-fg-muted">
                  This file does not expose a navigable table of contents.
                </Body>
              )}

              {tocEntries.map((entry) => {
                const isActive = hrefMatches(
                  entry.href,
                  currentChapterHref ?? "",
                );

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onChapterSelect?.(entry.href)}
                    aria-current={isActive ? "location" : undefined}
                    className={cn(
                      "w-full border-l py-1.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                      isActive
                        ? "border-border-strong text-fg"
                        : "border-transparent text-fg-muted hover:text-fg",
                    )}
                    style={{
                      paddingLeft: `${1 + entry.depth * 0.85}rem`,
                    }}
                  >
                    <Body
                      as="span"
                      className={cn(
                        "block min-w-0 text-sm leading-6",
                        isActive ? "text-fg" : "text-inherit",
                      )}
                    >
                      {entry.label}
                    </Body>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </section>

        {/* Notes & annotations (right) */}
        <section
          aria-label="Notes"
          className={cn(
            "flex h-full min-h-0 w-[clamp(17rem,26vw,32rem)] flex-col border-l border-border-strong/70 backdrop-blur-sm transition-all duration-200 ease-out",
            visible && notesOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--ra-main-surface-color) 84%, transparent)",
          }}
        >
          <AnnotationsPanel
            bookId={bookId}
            enabled={notesOpen}
            tocEntries={tocEntries}
            onNavigateTo={(cfiRange) => onAnnotationSelect?.(cfiRange)}
          />
        </section>
      </div>
    </div>
  );
}
