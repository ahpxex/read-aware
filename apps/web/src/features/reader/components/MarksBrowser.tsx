import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Body, ChoiceGroup, IconButton, InlineError, ScrollArea, SearchField, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { describeErrorCode, formatNumber, useTranslation } from "../../../i18n";
import type { Highlight, Note } from "../../annotations";
import { matchAnnotations } from "../lib/contents-search";

export type MarksFilter = "all" | "highlight" | "note";
type Mark = Highlight | Note;

type MarksBrowserProps = {
  /** Every mark in scope; the counts and the empty state read these. */
  marks: Mark[];
  isLoading: boolean;
  /** The read failed: an error, never "nothing here". */
  loadFailed: boolean;
  loadErrorCode?: string;
  onRetry: () => void;
  filter: MarksFilter;
  onFilterChange: (filter: MarksFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** What to say when there are no marks at all. */
  emptyMessage: string;
  /** Lays out the marks the filter and search leave (never called with none). */
  children: (shown: Mark[]) => ReactNode;
  className?: string;
  /** The scrolling list's own class, for the host to line rows up with the filters. */
  listClassName?: string;
};

/**
 * Highlights and notes, filtered by kind and searched with the reader's own
 * matcher: the filters on one row, with search behind an icon at its end that
 * opens a quiet field in place (closing it, or Escape, clears the query); the
 * list scrolls below. The host decides how the remaining marks are laid out —
 * by chapter for one book, by book across the library.
 */
export function MarksBrowser({
  marks,
  isLoading,
  loadFailed,
  loadErrorCode,
  onRetry,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  emptyMessage,
  children,
  className,
  listClassName,
}: MarksBrowserProps) {
  const { t } = useTranslation(["reader", "common"]);
  const highlightCount = marks.filter((mark) => mark.type === "highlight").length;
  const noteCount = marks.length - highlightCount;
  const trimmed = query.trim();
  const shown = useMemo(() => {
    const ofKind = filter === "all" ? marks : marks.filter((mark) => mark.type === filter);
    return trimmed ? (matchAnnotations(ofKind, trimmed) as Mark[]) : ofKind;
  }, [marks, filter, trimmed]);
  const failure = describeErrorCode(loadErrorCode ?? "annotations/observation-failed");

  const [searching, setSearching] = useState(query !== "");
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Set when search closes, so focus returns to the icon that opened it. */
  const refocusSearchButton = useRef(false);
  useEffect(() => {
    if (searching) fieldRef.current?.focus();
    else if (refocusSearchButton.current) {
      refocusSearchButton.current = false;
      searchButtonRef.current?.focus();
    }
  }, [searching]);
  const closeSearch = () => {
    onQueryChange("");
    refocusSearchButton.current = true;
    setSearching(false);
  };

  const countsKnown = !isLoading && !loadFailed;
  const count = (value: number) => (countsKnown ? ` ${formatNumber(value)}` : "");

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex min-h-8 items-center gap-3 border-b border-border pb-1">
        <ChoiceGroup
          ariaLabel={t("marks.filter")}
          className="shrink-0"
          value={filter}
          onChange={onFilterChange}
          options={[
            { value: "all", label: t("marks.all") },
            { value: "highlight", label: `${t("marks.highlights")}${count(highlightCount)}` },
            { value: "note", label: `${t("marks.notes")}${count(noteCount)}` },
          ]}
        />
        {searching ? (
          <SearchField
            ref={fieldRef}
            size="sm"
            variant="plain"
            className="ml-auto min-w-0 flex-1"
            label={t("marks.search")}
            placeholder={t("marks.search")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onDismiss={closeSearch}
            dismissLabel={t("marks.closeSearch")}
          />
        ) : (
          <IconButton
            ref={searchButtonRef}
            size="sm"
            className="ml-auto"
            label={t("marks.search")}
            onClick={() => setSearching(true)}
            icon={<MagnifyingGlass size={16} aria-hidden="true" />}
          />
        )}
      </div>
      <ScrollArea className={cn("min-h-0 flex-1", listClassName)}>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : loadFailed ? (
          <div className="px-4 py-4">
            <InlineError
              onRetry={failure?.retryable ? onRetry : undefined}
              retryLabel={t("common:errorBoundary.retry")}
            >
              {failure?.body ?? t("common:errors.generic")}
            </InlineError>
          </div>
        ) : marks.length === 0 ? (
          <Body className="px-4 py-4 text-sm text-fg-muted">{emptyMessage}</Body>
        ) : shown.length === 0 ? (
          <Body className="px-4 py-4 text-sm text-fg-muted">
            {trimmed ? t("marks.noMatches", { query: trimmed }) : t("marks.nothingToShow")}
          </Body>
        ) : (
          children(shown)
        )}
      </ScrollArea>
    </div>
  );
}
