import { useMemo, type Ref } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { Body, ChoiceGroup, IconButton, SearchField } from "@read-aware/ui";
import { formatNumber, useTranslation } from "../../../i18n";
import type { Highlight, Note } from "../../annotations";
import { matchAnnotations, ReaderNotesList, type ChapterAnchor } from "../../reader";

export type BookMarksFilter = "all" | "highlight" | "note";

type BookMarksPageProps = {
  marks: (Highlight | Note)[];
  chapters: readonly ChapterAnchor[];
  isLoading: boolean;
  loadFailed: boolean;
  loadErrorCode?: string;
  onRetry: () => void;
  filter: BookMarksFilter;
  onFilterChange: (filter: BookMarksFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  /** Focus lands here on entry, so the way back is the first stop. */
  backRef?: Ref<HTMLButtonElement>;
  onOpenPassage: (cfi: string) => void;
  onDelete: (id: string) => void;
};

/**
 * The book details dialog's second page: the book's highlights and notes,
 * searchable and filterable, listed the way the reader's notes view lists them
 * (grouped by chapter, newest first within one). A row opens the book there.
 *
 * Fixed height, with only the list scrolling, so typing a search or switching
 * the filter never makes the dialog jump.
 */
export function BookMarksPage({
  marks,
  chapters,
  isLoading,
  loadFailed,
  loadErrorCode,
  onRetry,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onBack,
  backRef,
  onOpenPassage,
  onDelete,
}: BookMarksPageProps) {
  const { t } = useTranslation("shelf");
  const highlightCount = marks.filter((mark) => mark.type === "highlight").length;
  const noteCount = marks.length - highlightCount;

  const shown = useMemo(() => {
    const ofKind = filter === "all" ? marks : marks.filter((mark) => mark.type === filter);
    return query.trim() ? matchAnnotations(ofKind, query) : ofKind;
  }, [marks, filter, query]);
  const emptyResult = !isLoading && !loadFailed && marks.length > 0 && shown.length === 0;

  return (
    <div className="flex h-[min(34rem,70vh)] flex-col">
      <div className="-ml-2 flex items-center gap-1 pb-3">
        <IconButton
          ref={backRef}
          label={t("details.back")}
          onClick={onBack}
          icon={<CaretLeft size={18} aria-hidden="true" />}
        />
        <Body as="h2" className="font-sans text-sm font-medium text-fg">
          {t("details.annotations")}
        </Body>
      </div>
      <SearchField
        label={t("details.searchMarks")}
        placeholder={t("details.searchMarks")}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <ChoiceGroup
        ariaLabel={t("details.filterMarks")}
        className="pt-3"
        value={filter}
        onChange={onFilterChange}
        options={[
          { value: "all", label: t("details.filterAll") },
          { value: "highlight", label: `${t("details.highlights")} ${formatNumber(highlightCount)}` },
          { value: "note", label: `${t("details.notes")} ${formatNumber(noteCount)}` },
        ]}
      />
      <div className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto border-t border-border">
        {emptyResult ? (
          <Body className="px-4 py-4 text-sm text-fg-muted">
            {query.trim() ? t("details.noMatches", { query: query.trim() }) : t("workspace.nothingToShow")}
          </Body>
        ) : (
          <ReaderNotesList
            annotations={shown}
            loadFailed={loadFailed}
            loadErrorCode={loadErrorCode}
            isLoading={isLoading}
            onRetryLoad={onRetry}
            tocEntries={chapters}
            onNavigate={onOpenPassage}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}
