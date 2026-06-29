import { Eyebrow } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { LibraryBook, ShelfSection as LibraryShelfSection } from "../../library/lib/library-types";
import type { ShelfLayout } from "../lib/shelf-view";
import { BookCover } from "./BookCover";
import { BookRow } from "./BookRow";
import { CollectionTile, type CollectionTileData } from "./CollectionTile";

type SectionBodyProps = {
  books: LibraryBook[];
  layout: ShelfLayout;
  /** Collection tiles rendered as peers ahead of the books (top-level only). */
  collections?: CollectionTileData[];
  onOpenCollection?: (id: string) => void;
  selecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  onToggleSelect?: (book: LibraryBook) => void;
};

function SectionBody({
  books,
  layout,
  collections = [],
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onToggleSelect,
}: SectionBodyProps) {
  const tiles = collections.map((data) => (
    <CollectionTile
      key={`collection-${data.id}`}
      data={data}
      layout={layout}
      onOpen={() => onOpenCollection?.(data.id)}
    />
  ));

  if (layout === "list") {
    return (
      <div className="flex flex-col divide-y divide-border/60">
        {tiles}
        {books.map((book) => (
          <BookRow
            key={book.id}
            book={book}
            selecting={selecting}
            selected={selectedIds?.has(book.id) ?? false}
            onClick={() => onSelect?.(book)}
            onRemove={() => onRemove?.(book)}
            onToggleStar={() => onToggleStar?.(book)}
            onToggleSelect={() => onToggleSelect?.(book)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {tiles}
      {books.map((book) => (
        <BookCover
          key={book.id}
          book={book}
          selecting={selecting}
          selected={selectedIds?.has(book.id) ?? false}
          onClick={() => onSelect?.(book)}
          onRemove={() => onRemove?.(book)}
          onToggleStar={() => onToggleStar?.(book)}
          onToggleSelect={() => onToggleSelect?.(book)}
        />
      ))}
    </div>
  );
}

type ShelfProps = {
  sections: LibraryShelfSection[];
  layout: ShelfLayout;
  /** Collection tiles to lead the grid (top-level view only). */
  collections?: CollectionTileData[];
  onOpenCollection?: (id: string) => void;
  selecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  onToggleSelect?: (book: LibraryBook) => void;
  className?: string;
};

export function Shelf({
  sections,
  layout,
  collections = [],
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onToggleSelect,
  className,
}: ShelfProps) {
  // Collections lead the first section so they sit in the same grid as the books;
  // when there are no book sections they get a section of their own.
  const effectiveSections =
    sections.length > 0 ? sections : collections.length > 0 ? [{ label: "", books: [] }] : [];

  return (
    <div className={cn(layout === "list" ? "space-y-8" : "space-y-12", className)}>
      {effectiveSections.map((section, index) => (
        <section key={section.label || `section-${index}`}>
          {section.label && <Eyebrow className="mb-4 block">{section.label}</Eyebrow>}
          <SectionBody
            books={section.books}
            layout={layout}
            collections={index === 0 ? collections : []}
            onOpenCollection={onOpenCollection}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onRemove={onRemove}
            onToggleStar={onToggleStar}
            onToggleSelect={onToggleSelect}
          />
        </section>
      ))}
    </div>
  );
}
