import { Body, InlineError, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeErrorCode } from "../../../i18n/describe-error";
import { AnnotationRow, type Annotation } from "../../annotations";
import { normalizeHref } from "../lib/epub-utils";
import type { TocEntry } from "../lib/reader-types";
import { ReaderBookmarkSection, type ReaderBookmarks } from "./ReaderBookmarkList";

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
 * The notes view of the reader's side panel: the book's bookmarks, then its
 * highlights and notes grouped by chapter in reading order. The host scrolls.
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
  /** The book's bookmarks, listed first. */
  bookmarks?: ReaderBookmarks;
}) {
  const { t } = useTranslation(["reader", "common"]);
  const groups = groupByTocOrder(annotations, tocEntries);
  const failure = describeErrorCode(loadErrorCode);

  return (
    // Its labels start where the contents' entries do (1.75rem: the inset
    // plus each row's own pl-2), so switching views does not shift the text.
    <div data-swipe-reveal-scope className="flex flex-col gap-3 px-5 py-4">
      {bookmarks && <ReaderBookmarkSection {...bookmarks} />}
      {loadFailed ? (
        <div className="px-1 py-3">
          <InlineError
            onRetry={failure?.retryable ? onRetryLoad : undefined}
            retryLabel={t("common:errorBoundary.retry")}
          >
            {failure?.body ?? t("common:errors.generic")}
          </InlineError>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : annotations.length === 0 ? (
        <Body className="px-2 py-4 text-sm text-fg-muted">{t("emptyNotes")}</Body>
      ) : (
        groups.map((group, index) => (
          <div key={group.label ?? `__rest__${index}`}>
            {/* Pinned while its chapter's notes scroll past, over the panel's surface. */}
            {group.label && (
              <p className="sticky top-0 z-[1] bg-[var(--ra-panel-surface,var(--ra-main-surface-color))] px-2 py-1.5 font-sans text-xs font-medium text-fg-subtle">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-1">
              {group.items.map((annotation) => (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  onNavigate={onNavigate}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
