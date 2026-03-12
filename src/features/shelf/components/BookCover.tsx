import { Progress } from "../../../components";
import { cn } from "../../../components/lib/cn";

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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full max-w-32 justify-self-start flex-col text-left sm:max-w-36 lg:max-w-44",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100",
        className,
      )}
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

      {book.progress !== undefined && (
        <div className="mt-2">
          <Progress value={book.progress} size="sm" />
          <span className="mt-1 block font-sans text-[11px] tabular-nums text-stone-500">
            {Math.round(book.progress)}%
          </span>
        </div>
      )}
    </button>
  );
}
