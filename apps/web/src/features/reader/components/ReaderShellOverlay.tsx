import { CaretLeft, Highlighter } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { Body, Caption, ScrollArea } from "@read-aware/ui";
import { hrefMatches } from "../lib/epub-utils";
import type { TocEntry } from "../lib/epub-types";

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
      {/* Top bar */}
      <div
        className={cn(
          "pointer-events-auto shrink-0 border-b border-stone-200/60 bg-stone-100/90 px-5 py-3 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
          >
            <CaretLeft size={16} weight="regular" aria-hidden="true" />
            <span className="font-sans text-caption font-medium">Library</span>
          </button>

          {title && (
            <div className="min-w-0 flex-1 text-center">
              <Body
                className="truncate text-sm font-medium text-stone-950"
              >
                {title}
              </Body>
              {subtitle && (
                <Caption className="truncate text-stone-500">
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
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
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
              "pointer-events-auto flex h-full min-h-0 w-full max-w-[18rem] flex-col border-r border-stone-300/70 backdrop-blur-sm transition-all duration-200 ease-out",
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
                  <Body className="px-2 py-2 text-sm text-stone-500">
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
                        "w-full border-l py-1.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                        isActive
                          ? "border-stone-400 text-stone-950"
                          : "border-transparent text-stone-500 hover:text-stone-950",
                      )}
                      style={{
                        paddingLeft: `${1 + entry.depth * 0.85}rem`,
                      }}
                    >
                      <Body
                        as="span"
                        className={cn(
                          "block min-w-0 text-sm leading-6",
                          isActive ? "text-stone-950" : "text-inherit",
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
        className={cn(
          "pointer-events-auto shrink-0 border-t border-stone-200/60 bg-stone-100/90 px-5 py-3 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-4">
          {currentPosition && (
            <Caption key={currentPosition} className="ra-motion-page-counter shrink-0 text-stone-500">
              {currentPosition}
            </Caption>
          )}

          {percent != null && (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full rounded-full bg-stone-400 transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <Caption key={Math.round(percent)} className="ra-motion-page-counter shrink-0 tabular-nums text-stone-500">
                {Math.round(percent)}%
              </Caption>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
