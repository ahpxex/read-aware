import { Info, Star, Trash } from "@phosphor-icons/react";
import { IconButton, Progress } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import type { LibraryBook } from "../../library/lib/library-types";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";
import { BookDetailsDialog, BookRemoveDialog } from "./BookDialogs";

type BookCoverProps = {
  book: LibraryBook;
  onClick?: () => void;
  onRemove?: () => void;
  onToggleStar?: () => void;
  className?: string;
};

export function BookCover({ book, onClick, onRemove, onToggleStar, className }: BookCoverProps) {
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
        onClick={onClick}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-fill"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm transition-shadow group-hover:shadow-md group-focus-within:shadow-md">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={`${book.title} cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <BookCoverPlaceholder
              title={book.title}
              author={book.author}
              format={book.format}
            />
          )}
        </div>
      </button>

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
              label={book.starred ? `Unstar ${book.title}` : `Star ${book.title}`}
              size="sm"
              aria-pressed={book.starred ?? false}
              onClick={() => onToggleStar?.()}
              className="rounded-sm text-white/70 hover:text-white focus-visible:ring-white"
              icon={<Star size={14} weight={book.starred ? "fill" : "regular"} aria-hidden="true" />}
            />
            <IconButton
              label={`Info about ${book.title}`}
              size="sm"
              onClick={() => setInfoOpen(true)}
              className="rounded-sm text-white/70 hover:text-white focus-visible:ring-white"
              icon={<Info size={14} weight="regular" aria-hidden="true" />}
            />
            <IconButton
              label={`Remove ${book.title}`}
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
                {Math.round(book.progressPercent)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {book.starred && (
        <div
          className="pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950/55 text-white"
          aria-hidden="true"
        >
          <Star size={11} weight="fill" />
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
