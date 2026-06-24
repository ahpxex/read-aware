import { CaretLeft, Highlighter } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { Body, Caption, ScrollArea } from "@read-aware/ui";
import { hrefMatches } from "../lib/epub-utils";
import type { TocEntry } from "../lib/reader-types";

type ReaderShellOverlayProps = {
  visible: boolean;
  onBack: () => void;
  title?: string;
  subtitle?: string;
  progress?: number;
  currentPosition?: string;
  tocEntries?: TocEntry[];
  currentChapterHref?: string | null;
  onChapterSelect?: (href: string) => void;
  onToggleAnnotations?: () => void;
  /** Reader background colour (varies by reading theme) — used for the
      gradient fades so the overlay bars blend seamlessly with the canvas. */
  themeBg: string;
};

export function ReaderShellOverlay({
  visible,
  onBack,
  title,
  subtitle,
  progress,
  currentPosition,
  tocEntries = [],
  currentChapterHref = null,
  onChapterSelect,
  onToggleAnnotations,
  themeBg,
}: ReaderShellOverlayProps) {
  const percent =
    progress != null ? Math.min(100, Math.max(0, progress * 100)) : null;
  const shouldShowTocPanel = visible && (!!title || tocEntries.length > 0);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden",
      )}
    >
      {/* Top bar — doubles as the window drag region on desktop, with left
          padding that clears the macOS traffic lights when present. */}
      <div
        data-tauri-drag-region=""
        style={{
          paddingLeft: "max(1.25rem, var(--ra-traffic-light-inset))",
          paddingRight: "1.25rem",
          background: `linear-gradient(to bottom, ${themeBg}, ${themeBg} 55%, ${themeBg}00)`,
        }}
        className={cn(
          "pointer-events-auto shrink-0 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3 pt-2.5 pb-7">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
          >
            <CaretLeft size={16} weight="regular" aria-hidden="true" />
            <span className="font-sans text-caption font-medium">Shelf</span>
          </button>

          {title && (
            <div className="pointer-events-none min-w-0 flex-1 text-center">
              <Body
                className="truncate text-sm font-medium text-fg"
              >
                {title}
              </Body>
              {subtitle && (
                <Caption className="truncate text-fg-muted">
                  {subtitle}
                </Caption>
              )}
            </div>
          )}

          <div className="flex w-16 shrink-0 justify-end">
            {onToggleAnnotations && (
              <button
                type="button"
                onClick={onToggleAnnotations}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                aria-label="Annotations"
              >
                <Highlighter size={16} weight="regular" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Middle zone -- keeps overlay chrome interactive while letting the reader scroll underneath */}
      <div className="pointer-events-none flex min-h-0 flex-1 items-stretch justify-start">
        {shouldShowTocPanel && (
          <section
            aria-label="Table of contents"
            className={cn(
              "pointer-events-auto flex h-full min-h-0 w-full max-w-[18rem] flex-col border-r border-border-strong/70 backdrop-blur-sm transition-all duration-200 ease-out",
              visible
                ? "translate-x-0 opacity-100"
                : "-translate-x-4 opacity-0 pointer-events-none",
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
        )}
      </div>

      {/* Bottom bar */}
      <div
        style={{
          background: `linear-gradient(to top, ${themeBg}, ${themeBg} 55%, ${themeBg}00)`,
        }}
        className={cn(
          "pointer-events-auto shrink-0 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-4 px-5 pt-7 pb-2.5">
          {currentPosition && (
            <Caption key={currentPosition} className="ra-motion-page-counter shrink-0 text-fg-muted">
              {currentPosition}
            </Caption>
          )}

          {percent != null && (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="h-px flex-1 overflow-hidden rounded-full bg-fill-strong">
                <div
                  className="h-full rounded-full bg-fg-subtle transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <Caption key={Math.round(percent)} className="ra-motion-page-counter shrink-0 tabular-nums text-fg-muted">
                {Math.round(percent)}%
              </Caption>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
