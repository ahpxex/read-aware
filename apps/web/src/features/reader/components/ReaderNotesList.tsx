import { Body, InlineError, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeErrorCode } from "../../../i18n/describe-error";
import { AnnotationRow, type Annotation } from "../../annotations";
import { groupMarksByChapter, type Mark } from "../lib/notes-grouping";
import type { TocEntry } from "../lib/reader-types";
import { BookmarkRow, type ReaderBookmarks } from "./ReaderBookmarkList";

/**
 * The notes view of the reader's side panel: the book's bookmarks,
 * highlights and notes in one list, grouped by chapter in reading order and
 * newest first within a chapter. The host scrolls.
 */
export function ReaderNotesList({
  annotations,
  loadFailed = false,
  loadErrorCode,
  isLoading = false,
  onRetryLoad,
  tocEntries,
  onNavigate,
  onDelete,
  bookmarks,
}: {
  annotations: Annotation[];
  /** The read failed — render an error state, never "no annotations yet". */
  loadFailed?: boolean;
  loadErrorCode?: string;
  isLoading?: boolean;
  onRetryLoad?: () => void;
  tocEntries: TocEntry[];
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
  /** The book's bookmarks, listed among the annotations. */
  bookmarks?: ReaderBookmarks;
}) {
  const { t } = useTranslation(["reader", "common"]);
  const marks: Mark[] = [
    ...(bookmarks?.bookmarks ?? []).map((bookmark) => ({ kind: "bookmark" as const, bookmark })),
    ...(loadFailed || isLoading ? [] : annotations).map((annotation) => ({ kind: "annotation" as const, annotation })),
  ];
  const groups = groupMarksByChapter(marks, tocEntries);
  const failure = describeErrorCode(loadErrorCode);

  return (
    // A narrow inset: rows carry their own padding and hover surface.
    <div data-swipe-reveal-scope className="flex flex-col gap-3 px-2 py-3">
      {loadFailed && (
        <div className="px-1 py-3">
          <InlineError
            onRetry={failure?.retryable ? onRetryLoad : undefined}
            retryLabel={t("common:errorBoundary.retry")}
          >
            {failure?.body ?? t("common:errors.generic")}
          </InlineError>
        </div>
      )}
      {bookmarks?.failed && (
        <div className="px-1 py-3">
          <InlineError compact>{t("bookmarksLoadFailed")}</InlineError>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : marks.length === 0 && !loadFailed && !bookmarks?.failed ? (
        <Body className="px-2 py-4 text-sm text-fg-muted">{t("emptyNotes")}</Body>
      ) : (
        groups.map((group, index) => (
          <div key={group.label ?? `__rest__${index}`}>
            {/* Pinned while its chapter's marks scroll past, over the panel's surface. */}
            {group.label && (
              <p className="sticky top-0 z-[1] bg-[var(--ra-panel-surface,var(--ra-main-surface-color))] px-2 py-1.5 font-sans text-xs font-medium text-fg-subtle">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-1">
              {group.items.map((mark) =>
                mark.kind === "bookmark" ? (
                  <BookmarkRow
                    key={`b:${mark.bookmark.id}`}
                    bookmark={mark.bookmark}
                    onOpen={bookmarks!.onOpen}
                    onRename={bookmarks!.onRename}
                    onRemove={bookmarks!.onRemove}
                  />
                ) : (
                  <AnnotationRow
                    key={mark.annotation.id}
                    annotation={mark.annotation}
                    onNavigate={onNavigate}
                    onDelete={onDelete}
                  />
                ),
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
