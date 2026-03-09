import { Eyebrow } from "../../../components";
import { BookCover, type Book } from "./BookCover";
import { cn } from "../../../components/lib/cn";

type ShelfSectionProps = {
  label: string;
  books: Book[];
  onSelect?: (book: Book) => void;
  className?: string;
};

function ShelfSection({ label, books, onSelect, className }: ShelfSectionProps) {
  return (
    <section className={className}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books.map((book) => (
          <BookCover
            key={book.id}
            book={book}
            onClick={() => onSelect?.(book)}
          />
        ))}
      </div>
    </section>
  );
}

type ShelfProps = {
  sections: { label: string; books: Book[] }[];
  onSelect?: (book: Book) => void;
  className?: string;
};

export function Shelf({ sections, onSelect, className }: ShelfProps) {
  return (
    <div className={cn("space-y-12", className)}>
      {sections.map((section) => (
        <ShelfSection
          key={section.label}
          label={section.label}
          books={section.books}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
