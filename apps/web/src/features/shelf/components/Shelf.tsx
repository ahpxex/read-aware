import { Eyebrow, Skeleton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type {
  BookMetadataPatch,
  LibraryBook,
  ShelfSection as LibraryShelfSection,
} from "../../library/lib/library-types";
import type { ShelfLayout } from "../lib/shelf-view";
import { BookCover } from "./BookCover";
import { BookRow } from "./BookRow";
import { CollectionTile, type CollectionTileData } from "./CollectionTile";

type SectionBodyProps = {
  books: LibraryBook[];
  layout: ShelfLayout;
  /** Collection tiles rendered as peers ahead of the books (top-level only). */
  collections?: CollectionTileData[];
  pendingBookIds?: ReadonlySet<string>;
  onOpenCollection?: (id: string) => void;
  selecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  onUpdateMetadata?: (book: LibraryBook, patch: BookMetadataPatch) => void;
  onToggleSelect?: (book: LibraryBook) => void;
  /** Book currently being opened (spinner feedback on its cover). */
  openingBookId?: string | null;
};

function PendingBookPlaceholder({ layout }: { layout: ShelfLayout }) {
  if (layout === "list") {
    return (
      <div aria-hidden="true" className="flex items-center gap-4 rounded-sm px-2 py-2">
        <Skeleton variant="rectangular" className="h-16 w-11 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton variant="text" className="w-1/3" />
          <Skeleton variant="text" className="w-1/5" />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="w-full max-w-32 justify-self-start space-y-2.5 sm:max-w-36 lg:max-w-44"
    >
      <Skeleton variant="rectangular" className="aspect-[2/3] w-full rounded-sm" />
      <Skeleton variant="text" className="w-3/4" />
    </div>
  );
}

function SectionBody({
  books,
  layout,
  collections = [],
  pendingBookIds,
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onUpdateMetadata,
  onToggleSelect,
  openingBookId,
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
          pendingBookIds?.has(book.id) ? (
            <PendingBookPlaceholder key={book.id} layout={layout} />
          ) : (
            <BookRow
              key={book.id}
              book={book}
              selecting={selecting}
              selected={selectedIds?.has(book.id) ?? false}
              opening={book.id === openingBookId}
              onClick={() => onSelect?.(book)}
              onRemove={() => onRemove?.(book)}
              onToggleStar={() => onToggleStar?.(book)}
              onUpdateMetadata={(patch) => onUpdateMetadata?.(book, patch)}
              onToggleSelect={() => onToggleSelect?.(book)}
            />
          )
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {tiles}
      {books.map((book) => (
        pendingBookIds?.has(book.id) ? (
          <PendingBookPlaceholder key={book.id} layout={layout} />
        ) : (
          <BookCover
            key={book.id}
            book={book}
            selecting={selecting}
            selected={selectedIds?.has(book.id) ?? false}
            opening={book.id === openingBookId}
            onClick={() => onSelect?.(book)}
            onRemove={() => onRemove?.(book)}
            onToggleStar={() => onToggleStar?.(book)}
            onUpdateMetadata={(patch) => onUpdateMetadata?.(book, patch)}
            onToggleSelect={() => onToggleSelect?.(book)}
          />
        )
      ))}
    </div>
  );
}

type ShelfProps = {
  sections: LibraryShelfSection[];
  layout: ShelfLayout;
  /** Collection tiles to lead the grid (top-level view only). */
  collections?: CollectionTileData[];
  /** Prepared imports rendered in their real sorted positions. */
  pendingBookIds?: ReadonlySet<string>;
  onOpenCollection?: (id: string) => void;
  selecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  onUpdateMetadata?: (book: LibraryBook, patch: BookMetadataPatch) => void;
  onToggleSelect?: (book: LibraryBook) => void;
  /** Book currently being opened (spinner feedback on its cover). */
  openingBookId?: string | null;
  className?: string;
};

export function Shelf({
  sections,
  layout,
  collections = [],
  pendingBookIds,
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onUpdateMetadata,
  onToggleSelect,
  openingBookId,
  className,
}: ShelfProps) {
  // Collections lead the first section so they sit in the same grid as the books;
  // when there are no book sections they get a section of their own.
  const effectiveSections =
    sections.length > 0
      ? sections
      : collections.length > 0
        ? [{ label: "", books: [] }]
        : [];

  return (
    <div className={cn(layout === "list" ? "space-y-8" : "space-y-12", className)}>
      {effectiveSections.map((section, index) => (
        <section key={section.label || `section-${index}`}>
          {section.label && <Eyebrow className="mb-4 block">{section.label}</Eyebrow>}
          <SectionBody
            books={section.books}
            layout={layout}
            collections={index === 0 ? collections : []}
            pendingBookIds={pendingBookIds}
            onOpenCollection={onOpenCollection}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onRemove={onRemove}
            onToggleStar={onToggleStar}
            onUpdateMetadata={onUpdateMetadata}
            onToggleSelect={onToggleSelect}
            openingBookId={openingBookId}
          />
        </section>
      ))}
    </div>
  );
}
