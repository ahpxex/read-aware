import type { Ref } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { Body, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { Highlight, Note } from "../../annotations";
import { MarksBrowser, ReaderNotesList, type ChapterAnchor, type MarksFilter } from "../../reader";

export type BookMarksFilter = MarksFilter;

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
 * the filter never makes the dialog jump. The filters and search are the
 * shared `MarksBrowser`, as on the highlights & notes page.
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
  const { t } = useTranslation(["shelf", "reader"]);
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
      <MarksBrowser
        className="flex-1"
        // The notes list insets its rows (for their hover surface) by two
        // steps; pulling it out by the same keeps chapter names and the
        // marks' rules on the filters' left edge.
        listClassName="-mx-4"
        marks={marks}
        isLoading={isLoading}
        loadFailed={loadFailed}
        loadErrorCode={loadErrorCode}
        onRetry={onRetry}
        filter={filter}
        onFilterChange={onFilterChange}
        query={query}
        onQueryChange={onQueryChange}
        emptyMessage={t("reader:emptyNotes")}
      >
        {(shown) => (
          <ReaderNotesList annotations={shown} tocEntries={chapters} onNavigate={onOpenPassage} onDelete={onDelete} />
        )}
      </MarksBrowser>
    </div>
  );
}
