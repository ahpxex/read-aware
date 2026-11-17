/**
 * The highlights & notes page: every book's marks in one place. A wide screen
 * lists the marked books down the left edge (every book first), the way the
 * Agent page docks its threads; a phone picks the book from a menu instead.
 * Either way the marks take the shared filters and search (`MarksBrowser`),
 * and list by chapter for one book, by book for all of them. A row opens the
 * book at its passage.
 *
 * Pure presentation: the observation, the contents read, opening and deleting
 * belong to the container (`useAnnotationsWorkspace`).
 */
import type { ReactNode } from "react";
import { Books } from "@phosphor-icons/react";
import { Body, ScrollArea, Select } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { formatNumber, useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library";
import { MarksBrowser, ReaderNotesList, type ChapterAnchor, type MarksFilter } from "../../reader";
import type { BookMarks, Mark } from "../lib/marks-by-book";

export type AnnotationsWorkspaceViewProps = {
  books: BookMarks<LibraryBook>[];
  selectedBookId: string | null;
  onSelectBook: (bookId: string | null) => void;
  isLoading: boolean;
  loadFailed: boolean;
  loadErrorCode?: string;
  onRetry: () => void;
  chapters: ChapterAnchor[];
  filter: MarksFilter;
  onFilterChange: (filter: MarksFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenPassage: (bookId: string, cfi: string) => void;
  onDelete: (id: string) => void;
};

export function AnnotationsWorkspaceView({
  books,
  selectedBookId,
  onSelectBook,
  isLoading,
  loadFailed,
  loadErrorCode,
  onRetry,
  chapters,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onOpenPassage,
  onDelete,
}: AnnotationsWorkspaceViewProps) {
  const { t } = useTranslation("reader");
  const isPhone = usePhoneViewport();
  const selected = selectedBookId ? books.find((entry) => entry.bookId === selectedBookId) : undefined;
  const titleOf = (entry: BookMarks<LibraryBook>) => entry.book?.title ?? t("marks.removedBook");
  const allMarks = books.flatMap((entry) => entry.marks);
  // A book whose last mark was just deleted keeps the page on it (now empty)
  // rather than jumping elsewhere under the reader's pointer.
  const scopeMarks = selectedBookId ? (selected?.marks ?? []) : allMarks;
  const heading = selectedBookId ? (selected ? titleOf(selected) : t("marks.removedBook")) : t("marks.allBooks");

  const browser = (
    <MarksBrowser
      className="min-h-0 flex-1"
      // The notes list insets its rows (for their hover surface) by two steps;
      // pulling it out by the same keeps the marks' rules on the filters' edge.
      listClassName="-mx-4"
      marks={scopeMarks}
      isLoading={isLoading}
      loadFailed={loadFailed}
      loadErrorCode={loadErrorCode}
      onRetry={onRetry}
      filter={filter}
      onFilterChange={onFilterChange}
      query={query}
      onQueryChange={onQueryChange}
      emptyMessage={t("marks.empty")}
    >
      {(shown) =>
        selectedBookId ? (
          <ReaderNotesList
            annotations={shown}
            tocEntries={chapters}
            onNavigate={(cfi) => onOpenPassage(selectedBookId, cfi)}
            onDelete={onDelete}
          />
        ) : (
          <MarksByBook
            books={books}
            shown={shown}
            titleOf={titleOf}
            onSelectBook={onSelectBook}
            {...{ onOpenPassage, onDelete }}
          />
        )
      }
    </MarksBrowser>
  );

  if (isPhone) {
    return (
      <div className="ra-motion-page-enter flex h-full min-h-0 flex-col px-4 pt-4">
        <Select
          ariaLabel={t("marks.books")}
          className="mb-3"
          value={selectedBookId ?? ""}
          onChange={(value) => onSelectBook(value || null)}
          options={[
            { value: "", label: t("marks.allBooks"), accessory: <Count value={allMarks.length} /> },
            ...books.map((entry) => ({
              value: entry.bookId,
              label: titleOf(entry),
              accessory: <Count value={entry.marks.length} />,
            })),
          ]}
        />
        {browser}
      </div>
    );
  }

  return (
    <div className="ra-motion-page-enter flex h-full min-h-0">
      <nav aria-label={t("marks.books")} className="flex w-64 shrink-0 flex-col border-r border-border">
        <h1 className="shrink-0 px-5 pt-6 pb-3 font-serif text-xl leading-display text-fg">{t("marks.title")}</h1>
        <ScrollArea className="min-h-0 flex-1 px-2 pb-6">
          <ul className="flex flex-col gap-px">
            <BookRow
              active={selectedBookId === null}
              title={t("marks.allBooks")}
              count={isLoading || loadFailed ? null : allMarks.length}
              onSelect={() => onSelectBook(null)}
              icon={<Books size={16} aria-hidden="true" />}
            />
            {books.map((entry) => (
              <BookRow
                key={entry.bookId}
                active={entry.bookId === selectedBookId}
                title={titleOf(entry)}
                count={entry.marks.length}
                onSelect={() => onSelectBook(entry.bookId)}
                icon={<Cover url={entry.book?.coverUrl} />}
              />
            ))}
          </ul>
        </ScrollArea>
      </nav>
      <section aria-label={heading} className="flex min-w-0 flex-1 justify-center px-8 pt-6">
        <div className="flex w-full max-w-3xl min-w-0 flex-col">
          <Body as="h2" className="mb-3 truncate font-serif text-lg text-fg">
            {heading}
          </Body>
          {browser}
        </div>
      </section>
    </div>
  );
}

/** Every book's marks: a heading per book (choosing it narrows the page to that book), its marks below. */
function MarksByBook({
  books,
  shown,
  titleOf,
  onSelectBook,
  onOpenPassage,
  onDelete,
}: {
  books: BookMarks<LibraryBook>[];
  shown: Mark[];
  titleOf: (entry: BookMarks<LibraryBook>) => string;
  onSelectBook: (bookId: string) => void;
  onOpenPassage: (bookId: string, cfi: string) => void;
  onDelete: (id: string) => void;
}) {
  const shownIds = new Set(shown.map((mark) => mark.id));
  return (
    <div className="pb-6">
      {books.map((entry) => {
        const marks = entry.marks.filter((mark) => shownIds.has(mark.id));
        if (marks.length === 0) return null;
        return (
          <section key={entry.bookId} aria-label={titleOf(entry)}>
            {/* Pinned while its book's marks scroll past, over the page's surface. */}
            <div className="sticky top-0 z-[1] bg-[var(--ra-main-surface-color)] px-2 pt-4">
              {/* oxlint-disable-next-line react/forbid-elements -- a book's heading that narrows the page to that book */}
              <button
                type="button"
                onClick={() => onSelectBook(entry.bookId)}
                className="flex max-w-full items-baseline gap-2 rounded-control px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
              >
                <span className="truncate font-serif text-base text-fg hover:text-fg-muted">{titleOf(entry)}</span>
                {entry.book?.author && (
                  <span className="shrink-0 truncate font-sans text-xs text-fg-subtle">{entry.book.author}</span>
                )}
              </button>
            </div>
            <ReaderNotesList
              annotations={marks}
              tocEntries={[]}
              onNavigate={(cfi) => onOpenPassage(entry.bookId, cfi)}
              onDelete={onDelete}
            />
          </section>
        );
      })}
    </div>
  );
}

function BookRow({
  active,
  title,
  count,
  onSelect,
  icon,
}: {
  active: boolean;
  title: string;
  /** Null while the count is unknown (loading or failed), not zero. */
  count: number | null;
  onSelect: () => void;
  icon: ReactNode;
}) {
  return (
    <li>
      {/* oxlint-disable-next-line react/forbid-elements -- a book in the page's book list, selectable like a thread row */}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        title={title}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-control px-2 py-1.5 text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          active ? "bg-fill-strong text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
        )}
      >
        <span className="flex h-8 w-6 shrink-0 items-center justify-center text-fg-subtle">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count !== null && (
          <>
            {/* Read as "Walden, 2", not "Walden2". */}
            <span className="sr-only">, </span>
            <Count value={count} />
          </>
        )}
      </button>
    </li>
  );
}

function Cover({ url }: { url?: string | null }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className="h-8 w-6 rounded-fine border border-border object-cover" />
  ) : (
    <span className="h-8 w-6 rounded-fine border border-border bg-fill" />
  );
}

function Count({ value }: { value: number }) {
  return <span className="shrink-0 font-sans text-xs tabular-nums text-fg-subtle">{formatNumber(value)}</span>;
}
