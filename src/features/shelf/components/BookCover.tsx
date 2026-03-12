import { Button, Dialog, IconButton, Progress } from "../../../components";
import { Info, Trash } from "@phosphor-icons/react";
import { cn } from "../../../components/lib/cn";
import { useLocalAtom } from "../../../state/local";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  progress?: number;
}

type BookCoverProps = {
  book: Book;
  onClick?: () => void;
  className?: string;
};

export function BookCover({ book, onClick, className }: BookCoverProps) {
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
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm transition-shadow group-hover:shadow-md group-focus-within:shadow-md">
          <img
            src={book.coverUrl ?? `https://picsum.photos/seed/${book.id}/240/360`}
            alt={`${book.title} cover`}
            className="h-full w-full object-cover"
          />
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
              className="rounded-sm text-white/70 hover:text-red-300 focus-visible:ring-white"
              icon={<Trash size={14} weight="regular" aria-hidden="true" />}
            />
          </div>

          {book.progress !== undefined && (
            <div>
              <Progress
                value={book.progress}
                size="sm"
                className="[&_[role='progressbar']]:bg-white/35 [&_[role='progressbar']>div]:bg-white"
              />
              <span className="mt-1 block font-sans text-[11px] tabular-nums text-white/75">
                {Math.round(book.progress)}%
              </span>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="Book details"
      >
        <div className="space-y-3">
          <p>This is mock book metadata until backend integration is ready.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-stone-700">
            <dt className="font-medium text-stone-600">Title</dt>
            <dd>{book.title}</dd>
            <dt className="font-medium text-stone-600">Author</dt>
            <dd>{book.author}</dd>
            <dt className="font-medium text-stone-600">Progress</dt>
            <dd>{book.progress !== undefined ? `${Math.round(book.progress)}%` : "Not started"}</dd>
          </dl>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setInfoOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Remove book?"
      >
        <div className="space-y-4">
          <p>
            This is mock confirmation content. We will later wire this action to
            remove <strong>{book.title}</strong> from your shelf.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => setRemoveOpen(false)}>
              Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
