import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { CaretRight } from "@phosphor-icons/react";
import { Body, Button, Caption, Dialog, InlineError, Progress, TextField, Toggle } from "@read-aware/ui";
import { formatNumber, formatPercent, useTranslation } from "../../../i18n";
import { describeErrorCode } from "../../../i18n/describe-error";
import { readingStatsAtom } from "../../../state/ui";
import type { BookMetadataPatch, LibraryBook } from "../../library";
import { formatReadingDuration, getBookReadingStats } from "../../reader";
import type { BookDetailsMarks } from "../hooks/useBookDetailsMarks";
import type { BookSpoilerProtection } from "../hooks/useBookSpoilerProtection";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";
import { BookMarksPage, type BookMarksFilter } from "./BookMarksPage";

export type BookDetailsDialogViewProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog offers inline editing of title/author. */
  onUpdateMetadata?: (patch: BookMetadataPatch) => void;
  /** The book's highlights and notes; the container observes them. */
  marks: BookDetailsMarks;
  /** The reader's spoiler-protection choice for this book; omitted where it cannot be saved. */
  spoilerProtection?: BookSpoilerProtection;
};

/** A single labelled figure in the stat strip. */
function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <Body className="truncate text-sm font-medium tabular-nums text-fg">{value}</Body>
    </div>
  );
}

/** A figure that opens the list it counts. */
function OpenableStat({
  label,
  value,
  buttonRef,
  onOpen,
}: {
  label: string;
  value: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  return (
    // oxlint-disable-next-line react/forbid-elements -- a stat-strip figure that opens the list it counts; Button's padding and type scale would break the strip's alignment
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      className="group -m-1.5 min-w-0 rounded-control p-1.5 text-left transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
    >
      <Caption className="block text-fg-subtle">{label}</Caption>
      <Body as="span" className="flex items-center gap-1 text-sm font-medium tabular-nums text-fg">
        <span className="truncate">{value}</span>
        <CaretRight
          size={12}
          aria-hidden="true"
          className="shrink-0 text-fg-subtle transition-colors group-hover:text-fg"
        />
      </Body>
    </button>
  );
}

type Page = { kind: "details" } | { kind: "marks"; from: "highlight" | "note" };

/**
 * Book details: cover and identity (with inline title/author editing for
 * correcting auto-detected metadata), reading progress and headline figures.
 * The highlight and note counts open a second page in the same dialog that
 * lists, filters and searches the book's marks. The exhaustive reading
 * breakdown lives on the Stats page.
 *
 * No visible title: the cover and the book's own title already say what the
 * dialog is; the accessible name still does.
 */
export function BookDetailsDialogView({
  book,
  open,
  onClose,
  onUpdateMetadata,
  marks,
  spoilerProtection,
}: BookDetailsDialogViewProps) {
  const { t } = useTranslation(["shelf", "common"]);
  const store = useAtomValue(readingStatsAtom);
  const readingTime = formatReadingDuration(getBookReadingStats(store, book.id).totalMs);
  const highlightCount = marks.marks.filter((mark) => mark.type === "highlight").length;
  const noteCount = marks.marks.length - highlightCount;
  const countsKnown = !marks.loadFailed && !marks.isLoading;
  const failure = marks.loadFailed ? describeErrorCode(marks.loadErrorCode) : null;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [page, setPage] = useState<Page>({ kind: "details" });
  const [filter, setFilter] = useState<BookMarksFilter>("all");
  const [query, setQuery] = useState("");
  const backRef = useRef<HTMLButtonElement | null>(null);
  const statRefs = useRef<Partial<Record<"highlight" | "note", HTMLButtonElement | null>>>({});
  /** Where focus goes after a page change; consumed by the effect below. */
  const pendingFocus = useRef<"back" | "highlight" | "note" | null>(null);

  // Reset whenever the dialog (re)opens or the book changes — not on close,
  // which would swap the page while the dialog is still fading out — so a
  // cancelled edit, a search or the marks page never carries over.
  useEffect(() => {
    if (open) {
      setEditing(false);
      setTitle(book.title);
      setAuthor(book.author);
      setPage({ kind: "details" });
      setFilter("all");
      setQuery("");
    }
  }, [open, book.id, book.title, book.author]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === "back" ? backRef.current : statRefs.current[target])?.focus();
  }, [page]);

  function openMarks(from: "highlight" | "note") {
    pendingFocus.current = "back";
    setFilter(from);
    setQuery("");
    setPage({ kind: "marks", from });
  }

  function backToDetails() {
    if (page.kind === "marks") pendingFocus.current = page.from;
    setPage({ kind: "details" });
  }

  function handleSave() {
    onUpdateMetadata?.({ title, author });
    setEditing(false);
  }

  function handleCancel() {
    setTitle(book.title);
    setAuthor(book.author);
    setEditing(false);
  }

  const countStat = (kind: "highlight" | "note", label: string, count: number) =>
    countsKnown && count > 0 ? (
      <OpenableStat
        label={label}
        value={formatNumber(count)}
        buttonRef={(node) => {
          statRefs.current[kind] = node;
        }}
        onOpen={() => openMarks(kind)}
      />
    ) : (
      <DetailStat label={label} value={countsKnown ? formatNumber(count) : "-"} />
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label={t("details.title")}
      className="max-w-lg max-h-[85vh] overflow-y-auto p-6"
    >
      {page.kind === "marks" ? (
        <BookMarksPage
          marks={marks.marks}
          chapters={marks.chapters}
          isLoading={marks.isLoading}
          loadFailed={marks.loadFailed}
          loadErrorCode={marks.loadErrorCode}
          onRetry={marks.retry}
          filter={filter}
          onFilterChange={setFilter}
          query={query}
          onQueryChange={setQuery}
          onBack={backToDetails}
          backRef={backRef}
          onOpenPassage={marks.openPassage}
          onDelete={marks.remove}
        />
      ) : (
        <div className="space-y-5">
          {/* Cover + identity (editable) */}
          <div className="flex gap-4">
            <div className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-mark shadow-md">
              {book.coverUrl ? (
                <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <BookCoverPlaceholder title={book.title} author={book.author} format={book.format} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="space-y-3">
                  <TextField
                    label={t("details.fieldTitle")}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <TextField
                    label={t("details.fieldAuthor")}
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                </div>
              ) : (
                <>
                  <Body as="h2" className="break-words font-serif text-lg font-medium leading-snug text-fg">
                    {book.title}
                  </Body>
                  <Body className="mt-1 break-words text-sm text-fg-muted">{book.author}</Body>
                  <Caption className="mt-2 block uppercase tracking-wide text-fg-subtle">{book.format}</Caption>
                </>
              )}
            </div>
          </div>

          {/* Reading progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Caption className="text-fg-subtle">{t("details.progress")}</Caption>
              <Caption className="tabular-nums text-fg-muted">
                {book.progressPercent > 0 ? formatPercent(book.progressPercent) : t("status.notStarted")}
              </Caption>
            </div>
            <Progress value={book.progressPercent} size="sm" />
          </div>

          {/* Headline figures; the mark counts open their list. */}
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
            <DetailStat label={t("details.fieldReading")} value={readingTime} />
            {countStat("highlight", t("details.highlights"), highlightCount)}
            {countStat("note", t("details.notes"), noteCount)}
          </div>
          {marks.loadFailed && (
            <InlineError
              compact
              onRetry={failure?.retryable ? marks.retry : undefined}
              retryLabel={t("common:errorBoundary.retry")}
            >
              {failure?.body ?? t("common:errors.generic")}
            </InlineError>
          )}

          {spoilerProtection && (
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div className="min-w-0">
                <Body className="text-sm text-fg">{t("details.spoilerProtection")}</Body>
                <Caption className="mt-0.5 block text-fg-muted">{t("details.spoilerProtectionHint")}</Caption>
              </div>
              <Toggle
                aria-label={t("details.spoilerProtection")}
                checked={spoilerProtection.enabled}
                disabled={spoilerProtection.saving}
                aria-busy={spoilerProtection.saving}
                onChange={spoilerProtection.setEnabled}
                className="shrink-0 pt-0.5"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  {t("actions.cancel")}
                </Button>
                <Button variant="solid" size="sm" onClick={handleSave}>
                  {t("details.save")}
                </Button>
              </>
            ) : (
              <>
                {onUpdateMetadata && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    {t("details.edit")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {t("actions.close")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
