import { Check, Info, Star, Trash } from "@phosphor-icons/react";
import { IconButton, Progress, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import { formatPercent, useTranslation } from "../../../i18n";
import type { BookMetadataPatch, LibraryBook } from "../../library/lib/library-types";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";
import { BookDetailsDialog, BookRemoveDialog } from "./BookDialogs";

type BookCoverProps = {
  book: LibraryBook;
  selecting?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  onToggleStar?: () => void;
  onUpdateMetadata?: (patch: BookMetadataPatch) => void;
  onToggleSelect?: () => void;
  /** This book is being opened: show a quiet spinner over the cover. */
  opening?: boolean;
  className?: string;
};

export function BookCover({
  book,
  selecting = false,
  selected = false,
  onClick,
  onRemove,
  onToggleStar,
  onUpdateMetadata,
  onToggleSelect,
  opening = false,
  className,
}: BookCoverProps) {
  const { t } = useTranslation("shelf");
  const [infoOpen, setInfoOpen] = useLocalAtom(false);
  const [removeOpen, setRemoveOpen] = useLocalAtom(false);

  return (
    <div
      className={cn(
        "group relative flex w-full max-w-32 justify-self-start flex-col text-left sm:max-w-36 lg:max-w-44",
        className,
      )}
    >
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onClick}
        aria-pressed={selecting ? selected : undefined}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-fill"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm transition-shadow group-hover:shadow-md group-focus-within:shadow-md">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={t("book.cover", { title: book.title })}
              className="h-full w-full object-cover"
            />
          ) : (
            <BookCoverPlaceholder
              title={book.title}
              author={book.author}
              format={book.format}
            />
          )}
          {/* Dim unselected covers in selection mode so the chosen ones stand out. */}
          {selecting && (
            <div
              className={cn(
                "absolute inset-0 transition-colors",
                selected ? "bg-transparent" : "bg-stone-950/35",
              )}
              aria-hidden="true"
            />
          )}
          {/* Opening feedback while the shelf holds over the mounting reader.
              The delayed fade keeps fast opens spinner-free. */}
          {opening && (
            <span
              className="ra-motion-fade-in absolute inset-0 flex items-center justify-center bg-paper/60"
              style={{ animationDelay: "150ms", animationFillMode: "backwards" }}
            >
              <Spinner size="sm" className="text-fg" />
            </span>
          )}
        </div>
      </button>

      {/* Hover detail + actions, suppressed while selecting (the card toggles instead). */}
      {!selecting && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between rounded-sm bg-stone-950/0 p-3 opacity-0 transition-all group-hover:bg-stone-950/80 group-hover:opacity-100 group-focus-within:bg-stone-950/80 group-focus-within:opacity-100">
          <div className="min-w-0">
            <span className="block text-left font-serif text-sm leading-tight font-medium break-words text-white/95">
              {book.title}
            </span>
            <span className="mt-1 block truncate text-left font-sans text-[11px] text-white/70">
              {book.author}
            </span>
          </div>

          <div className="space-y-2">
            <div className="pointer-events-auto flex justify-end gap-1">
              <IconButton
                label={book.starred ? t("book.unstar", { title: book.title }) : t("book.star", { title: book.title })}
                size="sm"
                aria-pressed={book.starred ?? false}
                onClick={() => onToggleStar?.()}
                className="rounded-sm text-white/70 hover:text-white focus-visible:ring-white"
                icon={<Star size={14} weight={book.starred ? "fill" : "regular"} aria-hidden="true" />}
              />
              <IconButton
                label={t("book.info", { title: book.title })}
                size="sm"
                onClick={() => setInfoOpen(true)}
                className="rounded-sm text-white/70 hover:text-white focus-visible:ring-white"
                icon={<Info size={14} weight="regular" aria-hidden="true" />}
              />
              <IconButton
                label={t("book.remove", { title: book.title })}
                size="sm"
                onClick={() => setRemoveOpen(true)}
                className="rounded-sm text-white/70 hover:text-red-400 focus-visible:ring-white"
                icon={<Trash size={14} weight="regular" aria-hidden="true" />}
              />
            </div>

            {book.progressPercent > 0 && (
              <div>
                <Progress
                  value={book.progressPercent}
                  size="sm"
                  className="[&_[role='progressbar']]:bg-white/35 [&_[role='progressbar']>div]:bg-white"
                />
                <span className="mt-1 block font-sans text-[11px] tabular-nums text-white/75">
                  {formatPercent(book.progressPercent)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selection checkbox, or the persistent star badge when not selecting. */}
      {selecting ? (
        <div
          className={cn(
            "pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full transition-colors",
            selected
              ? "bg-fg text-inverse-fg shadow-sm"
              : "border border-white/90 bg-stone-950/30 text-transparent",
          )}
          aria-hidden="true"
        >
          <Check size={12} weight="bold" />
        </div>
      ) : (
        book.starred && (
          <div
            className="pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950/55 text-white"
            aria-hidden="true"
          >
            <Star size={11} weight="fill" />
          </div>
        )
      )}

      <BookDetailsDialog
        book={book}
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        onUpdateMetadata={onUpdateMetadata}
      />
      <BookRemoveDialog
        book={book}
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => {
          setRemoveOpen(false);
          onRemove?.();
        }}
      />
    </div>
  );
}
