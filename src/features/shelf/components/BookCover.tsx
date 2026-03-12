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
        "group flex w-full max-w-32 justify-self-start flex-col text-left sm:max-w-36 lg:max-w-44",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm transition-shadow group-hover:shadow-md">
          <img
            src={book.coverUrl ?? `https://picsum.photos/seed/${book.id}/240/360`}
            alt={`${book.title} cover`}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex flex-col justify-end p-4 bg-stone-950/0 opacity-0 transition-all group-hover:bg-stone-950/60 group-hover:opacity-100">
            <span className="font-serif text-sm leading-tight font-medium text-white/90">
              {book.title}
            </span>
            <span className="mt-1 font-sans text-[11px] text-white/50">
              {book.author}
            </span>
          </div>
        </div>
      </button>

      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          {book.progress !== undefined && (
            <>
              <Progress value={book.progress} size="sm" />
              <span className="mt-1 block font-sans text-[11px] tabular-nums text-stone-500">
                {Math.round(book.progress)}%
              </span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={`Info about ${book.title}`}
            size="sm"
            onClick={() => setInfoOpen(true)}
            className="rounded-sm text-stone-500 hover:text-stone-950"
            icon={<Info size={14} weight="regular" aria-hidden="true" />}
          />
          <IconButton
            label={`Remove ${book.title}`}
            size="sm"
            onClick={() => setRemoveOpen(true)}
            className="rounded-sm text-stone-500 hover:text-red-700"
            icon={<Trash size={14} weight="regular" aria-hidden="true" />}
          />
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
