import { Eyebrow } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { LibraryBook, ShelfSection as LibraryShelfSection } from "../../library/lib/library-types";
import { BookCover } from "./BookCover";

type ShelfSectionProps = {
  label: string;
  books: LibraryBook[];
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  className?: string;
};

function ShelfSection({ label, books, onSelect, onRemove, className }: ShelfSectionProps) {
  return (
    <section className={className}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
        {books.map((book) => (
          <BookCover
            key={book.id}
            book={book}
            onClick={() => onSelect?.(book)}
            onRemove={() => onRemove?.(book)}
          />
        ))}
      </div>
    </section>
  );
}

type ShelfProps = {
  sections: LibraryShelfSection[];
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  className?: string;
};

export function Shelf({ sections, onSelect, onRemove, className }: ShelfProps) {
  return (
    <div className={cn("space-y-12", className)}>
      {sections.map((section) => (
        <ShelfSection
          key={section.label}
          label={section.label}
          books={section.books}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
