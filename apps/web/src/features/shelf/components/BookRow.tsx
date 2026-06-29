import { Check, Info, Star, Trash } from "@phosphor-icons/react";
import { IconButton, Progress } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import type { LibraryBook } from "../../library/lib/library-types";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";
import { BookDetailsDialog, BookRemoveDialog } from "./BookDialogs";

type BookRowProps = {
  book: LibraryBook;
  selecting?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  onToggleStar?: () => void;
  onToggleSelect?: () => void;
  className?: string;
};

export function BookRow({
  book,
  selecting = false,
  selected = false,
  onClick,
  onRemove,
  onToggleStar,
  onToggleSelect,
  className,
}: BookRowProps) {
  const [infoOpen, setInfoOpen] = useLocalAtom(false);
  const [removeOpen, setRemoveOpen] = useLocalAtom(false);

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-sm px-2 py-2 transition-colors",
        selected ? "bg-fg/[0.06]" : "hover:bg-fg/5",
        className,
      )}
    >
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onClick}
        aria-pressed={selecting ? selected : undefined}
        className="flex min-w-0 flex-1 items-center gap-4 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg rounded-sm"
      >
        {selecting && (
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
              selected ? "border-fg bg-fg text-inverse-fg" : "border-border-strong text-transparent",
            )}
            aria-hidden="true"
          >
            <Check size={12} weight="bold" />
          </span>
        )}
        <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-sm shadow-sm">
          {book.coverUrl ? (
            <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <BookCoverPlaceholder title={book.title} author={book.author} format={book.format} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-serif text-sm font-medium text-fg">
            {book.title}
          </span>
          <span className="mt-0.5 block truncate font-sans text-[13px] text-fg-muted">
            {book.author}
          </span>
        </div>
        <div className="hidden w-40 shrink-0 sm:block">
          {book.progressPercent > 0 ? (
            <div className="flex items-center gap-2">
              <Progress value={book.progressPercent} size="sm" className="flex-1" />
              <span className="w-9 shrink-0 text-right font-sans text-[11px] tabular-nums text-fg-muted">
                {Math.round(book.progressPercent)}%
              </span>
            </div>
          ) : (
            <span className="font-sans text-[11px] text-fg-subtle">
              {book.readingStatus === "finished" ? "Finished" : "Not started"}
            </span>
          )}
        </div>
      </button>

      {!selecting && (
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={book.starred ? `Unstar ${book.title}` : `Star ${book.title}`}
            size="sm"
            aria-pressed={book.starred ?? false}
            onClick={() => onToggleStar?.()}
            className={cn(
              "transition-opacity",
              book.starred
                ? "text-fg opacity-100"
                : "text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100",
            )}
            icon={<Star size={16} weight={book.starred ? "fill" : "regular"} aria-hidden="true" />}
          />
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton
              label={`Info about ${book.title}`}
              size="sm"
              onClick={() => setInfoOpen(true)}
              icon={<Info size={16} weight="regular" aria-hidden="true" />}
            />
            <IconButton
              label={`Remove ${book.title}`}
              size="sm"
              onClick={() => setRemoveOpen(true)}
              className="hover:text-red-600"
              icon={<Trash size={16} weight="regular" aria-hidden="true" />}
            />
          </div>
        </div>
      )}

      <BookDetailsDialog book={book} open={infoOpen} onClose={() => setInfoOpen(false)} />
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
