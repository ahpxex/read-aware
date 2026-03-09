import { Caption, Progress } from "../../../components";
import { cn } from "../../../components/lib/cn";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverColor?: string;
  progress?: number;
}

const palette = [
  "bg-stone-800",
  "bg-stone-700",
  "bg-stone-600",
  "bg-amber-900/80",
  "bg-stone-500",
  "bg-stone-900",
] as const;

function pickColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
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
        "group flex w-full flex-col text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100",
        className,
      )}
    >
      <div
        className={cn(
          "flex aspect-[2/3] w-full flex-col justify-end rounded-sm p-4 transition-shadow group-hover:shadow-md",
          book.coverColor ?? pickColor(book.id),
        )}
      >
        <span className="font-serif text-sm leading-tight font-medium text-white/90">
          {book.title}
        </span>
        <span className="mt-1 font-sans text-[11px] text-white/50">
          {book.author}
        </span>
      </div>

      <p className="mt-2.5 font-sans text-sm leading-snug text-stone-950">
        {book.title}
      </p>
      <Caption className="mt-0.5 text-stone-500">{book.author}</Caption>

      {book.progress !== undefined && (
        <Progress value={book.progress} size="sm" className="mt-2" />
      )}
    </button>
  );
}
