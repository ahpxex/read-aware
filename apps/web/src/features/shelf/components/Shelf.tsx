import { Eyebrow } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { LibraryBook, ShelfSection as LibraryShelfSection } from "../../library/lib/library-types";
import type { ShelfLayout } from "../lib/shelf-view";
import { BookCover } from "./BookCover";
import { BookRow } from "./BookRow";

type SectionBodyProps = {
  books: LibraryBook[];
  layout: ShelfLayout;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
};

function SectionBody({ books, layout, onSelect, onRemove, onToggleStar }: SectionBodyProps) {
  if (layout === "list") {
    return (
      <div className="flex flex-col divide-y divide-border/60">
        {books.map((book) => (
          <BookRow
            key={book.id}
            book={book}
            onClick={() => onSelect?.(book)}
            onRemove={() => onRemove?.(book)}
            onToggleStar={() => onToggleStar?.(book)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {books.map((book) => (
        <BookCover
          key={book.id}
          book={book}
          onClick={() => onSelect?.(book)}
          onRemove={() => onRemove?.(book)}
          onToggleStar={() => onToggleStar?.(book)}
        />
      ))}
    </div>
  );
}

type ShelfProps = {
  sections: LibraryShelfSection[];
  layout: ShelfLayout;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  className?: string;
};

export function Shelf({ sections, layout, onSelect, onRemove, onToggleStar, className }: ShelfProps) {
  return (
    <div className={cn(layout === "list" ? "space-y-8" : "space-y-12", className)}>
      {sections.map((section, index) => (
        <section key={section.label || `section-${index}`}>
          {section.label && <Eyebrow className="mb-4 block">{section.label}</Eyebrow>}
          <SectionBody
            books={section.books}
            layout={layout}
            onSelect={onSelect}
            onRemove={onRemove}
            onToggleStar={onToggleStar}
          />
        </section>
      ))}
    </div>
  );
}
