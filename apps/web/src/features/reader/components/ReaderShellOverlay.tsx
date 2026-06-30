import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { CaretLeft, ListBullets, Notebook } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { Body, IconButton, ScrollArea, Tooltip } from "@read-aware/ui";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { ReaderNotePanel } from "./ReaderNotePanel";
import type { LibraryBook } from "../../library/lib/library-types";
import { hrefMatches } from "../lib/epub-utils";
import { useReaderPanelLayout } from "../hooks/useReaderPanelLayout";
import type { TocEntry } from "../lib/reader-types";
import { ReaderAppearanceMenu } from "./ReaderAppearanceMenu";
import { ReaderStatsMenu } from "./ReaderStatsMenu";

type ReaderShellOverlayProps = {
  visible: boolean;
  onBack: () => void;
  book: LibraryBook;
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
  book,
  progress,
  currentPage,
  totalPages,
  tocEntries = [],
  currentChapterHref = null,
  onChapterSelect,
  onAnnotationSelect,
}: ReaderShellOverlayProps) {
  const bookId = book.id;
  const title = book.title;
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

  // TOC + notes panels persist per book (restored when the book reopens); the
  // appearance/stats popovers are transient and reset each session.
  const { tocOpen, notesOpen, notesTab, setTocOpen, setNotesOpen, setNotesTab } =
    useReaderPanelLayout(bookId);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  // "Ask AI about this" fires from the reader (a sibling component) via this
  // atom. Reveal the panel and switch to the Chat tab; the chat panel itself
  // adopts the passage. We track the handled id rather than clearing the atom so
  // the panel can react to the same dispatch independently.
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const handledAskAiIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!askAiRequest || askAiRequest.bookId !== bookId) return;
    if (askAiRequest.id === handledAskAiIdRef.current) return;
    handledAskAiIdRef.current = askAiRequest.id;
    setNotesOpen(true);
    setNotesTab("chat");
  }, [askAiRequest, bookId, setNotesOpen, setNotesTab]);

  // The two right-aligned popovers (appearance, stats) would overlap, so opening
  // one closes the other.
  const handleAppearanceOpenChange = (next: boolean) => {
    setAppearanceOpen(next);
    if (next) setStatsOpen(false);
  };
  const handleStatsOpenChange = (next: boolean) => {
    setStatsOpen(next);
    if (next) setAppearanceOpen(false);
  };

  // The popovers are transient — they close whenever the overlay is dismissed.
  // The contents and notes panels are NOT reset: they keep their open state so
  // dismissing then re-opening the header restores whatever the reader had
  // revealed. (Reset state lives in the panels' `visible &&` reveal gate.)
  useEffect(() => {
    if (!visible) {
      setAppearanceOpen(false);
      setStatsOpen(false);
    }
  }, [visible]);

  // Reveal the current chapter when the contents panel opens (or the chapter
  // changes while it's open), centering it so it's easy to find.
  const tocListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!visible || !tocOpen) return;
    const frame = window.requestAnimationFrame(() => {
      tocListRef.current
        ?.querySelector('[aria-current="location"]')
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, tocOpen, currentChapterHref]);

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
          // Left clears the macOS traffic lights; the right uses the plain edge
          // inset so the appearance/notes cluster sits flush against the right
          // edge instead of being pushed inward by a mirrored offset.
          paddingLeft: "max(1.25rem, var(--ra-traffic-light-inset))",
          paddingRight: "1.25rem",
        }}
        className={cn(
          // Fixed h-12 band, matching the main AppHeader. Both bars then center
          // their controls on the same 24px axis, so the single native
          // traffic-light inset (tuned for that band) aligns with both. A taller
          // bar would drop the controls below the lights.
          //
          // z-20 keeps the bar above the docked panels (z-10): its `backdrop-blur`
          // makes it a stacking context, so the appearance/stats popovers and the
          // button tooltips nested inside it would otherwise be painted under the
          // DOM-later Notes/contents panels. Lifting the whole band lifts them too.
          "pointer-events-auto relative z-20 h-12 shrink-0 bg-fill backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="pointer-events-none flex h-full items-center gap-3">
          {/* Left cluster: back to shelf + contents toggle */}
          <div className="ml-2 flex shrink-0 items-center gap-0.5">
            <Tooltip content="Shelf" side="bottom" className="pointer-events-auto">
              <IconButton
                size="sm"
                label="Back to shelf"
                onClick={onBack}
                icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            <Tooltip content="Contents" side="bottom" className="pointer-events-auto">
              <IconButton
                size="sm"
                label="Table of contents"
                aria-pressed={tocOpen}
                onClick={() => setTocOpen((open) => !open)}
                className={cn(tocOpen && "text-fg")}
                icon={
                  <ListBullets
                    size={18}
                    weight={tocOpen ? "bold" : "regular"}
                    aria-hidden="true"
                  />
                }
              />
            </Tooltip>
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

          {/* Right cluster: stats + appearance + notes */}
          <div className="flex shrink-0 items-center justify-end gap-0.5">
            <ReaderStatsMenu
              book={book}
              open={statsOpen}
              onOpenChange={handleStatsOpenChange}
            />
            <ReaderAppearanceMenu
              bookId={bookId}
              open={appearanceOpen}
              onOpenChange={handleAppearanceOpenChange}
            />
            <Tooltip content="Notes" side="bottom" className="pointer-events-auto">
              <IconButton
                size="sm"
                label="Notes"
                aria-pressed={notesOpen}
                onClick={() => setNotesOpen((open) => !open)}
                className={cn(notesOpen && "text-fg")}
                icon={
                  <Notebook
                    size={18}
                    weight={notesOpen ? "bold" : "regular"}
                    aria-hidden="true"
                  />
                }
              />
            </Tooltip>
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
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-stretch justify-between">
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
            <div ref={tocListRef} className="flex flex-col px-3 py-4">
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
                      "w-full border-l-2 py-1.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                      isActive
                        ? "border-fg bg-fill text-fg"
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
                        isActive ? "font-semibold text-fg" : "text-inherit",
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
          <ReaderNotePanel
            bookId={bookId}
            bookTitle={title}
            enabled={notesOpen}
            activeTab={notesTab}
            onTabChange={setNotesTab}
            tocEntries={tocEntries}
            onNavigateTo={(cfiRange) => onAnnotationSelect?.(cfiRange)}
          />
        </section>
      </div>
    </div>
  );
}
