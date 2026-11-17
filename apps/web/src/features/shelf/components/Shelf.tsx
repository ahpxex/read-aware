import { Eyebrow, Skeleton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type {
  BookMetadataPatch,
  LibraryBook,
  ShelfEntry,
  ShelfSection as LibraryShelfSection,
} from "../../library/lib/library-types";
import { collectionTileData } from "../lib/collection-tile-data";
import type { ShelfLayout } from "../lib/shelf-view";
import { BookCover } from "./BookCover";
import { BookRow } from "./BookRow";
import { CollectionTile } from "./CollectionTile";

type SectionBodyProps = {
  /** Books and collections, in shelf order. */
  entries: ShelfEntry[];
  layout: ShelfLayout;
  pendingBookIds?: ReadonlySet<string>;
  onOpenCollection?: (id: string) => void;
  selecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (book: LibraryBook) => void;
  onRemove?: (book: LibraryBook) => void;
  onToggleStar?: (book: LibraryBook) => void;
  onUpdateMetadata?: (book: LibraryBook, patch: BookMetadataPatch) => void;
  onToggleSelect?: (book: LibraryBook) => void;
  /** Ids a card drags for this book (selection-aware); absence disables dragging. */
  getDragIds?: (book: LibraryBook) => string[];
  /** Books dragged from the shelf were dropped on a collection tile. */
  onDropBooksOnCollection?: (collectionId: string, ids: string[]) => void;
  /** Book currently being opened (spinner feedback on its cover). */
  openingBookId?: string | null;
};

function PendingBookPlaceholder({ layout }: { layout: ShelfLayout }) {
  if (layout === "list") {
    return (
      <div aria-hidden="true" className="flex items-center gap-4 rounded-control px-2 py-2">
        <Skeleton variant="rectangular" className="h-16 w-11 shrink-0 rounded-mark" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton variant="text" className="w-1/3" />
          <Skeleton variant="text" className="w-1/5" />
        </div>
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="w-full max-w-32 justify-self-start space-y-2.5 sm:max-w-36 lg:max-w-44">
      <Skeleton variant="rectangular" className="aspect-[2/3] w-full rounded-mark" />
      <Skeleton variant="text" className="w-3/4" />
    </div>
  );
}

function SectionBody({
  entries,
  layout,
  pendingBookIds,
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onUpdateMetadata,
  onToggleSelect,
  getDragIds,
  onDropBooksOnCollection,
  openingBookId,
}: SectionBodyProps) {
  const items = entries.map((entry) => {
    if (entry.kind === "collection") {
      const { id } = entry.collection;
      return (
        <CollectionTile
          key={`collection-${id}`}
          data={collectionTileData(entry.collection, entry.members)}
          layout={layout}
          onOpen={() => onOpenCollection?.(id)}
          onDropBooks={onDropBooksOnCollection ? (ids) => onDropBooksOnCollection(id, ids) : undefined}
        />
      );
    }
    const { book } = entry;
    if (pendingBookIds?.has(book.id)) return <PendingBookPlaceholder key={book.id} layout={layout} />;
    const Card = layout === "list" ? BookRow : BookCover;
    return (
      <Card
        key={book.id}
        book={book}
        getDragIds={getDragIds ? () => getDragIds(book) : undefined}
        selecting={selecting}
        selected={selectedIds?.has(book.id) ?? false}
        opening={book.id === openingBookId}
        onClick={() => onSelect?.(book)}
        onRemove={() => onRemove?.(book)}
        onToggleStar={() => onToggleStar?.(book)}
        onUpdateMetadata={(patch) => onUpdateMetadata?.(book, patch)}
        onToggleSelect={() => onToggleSelect?.(book)}
      />
    );
  });

  if (layout === "list") return <div className="flex flex-col divide-y divide-border/60">{items}</div>;

  return (
    // Above 2xl the fixed column steps hand over to auto-fill, so covers keep
    // flowing into new columns on any wider window instead of gaining gutters.
    <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      {items}
    </div>
  );
}

type ShelfProps = {
  sections: LibraryShelfSection[];
  layout: ShelfLayout;
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
  /** Ids a card drags for this book (selection-aware); absence disables dragging. */
  getDragIds?: (book: LibraryBook) => string[];
  /** Books dragged from the shelf were dropped on a collection tile. */
  onDropBooksOnCollection?: (collectionId: string, ids: string[]) => void;
  /** Book currently being opened (spinner feedback on its cover). */
  openingBookId?: string | null;
  className?: string;
};

export function Shelf({
  sections,
  layout,
  pendingBookIds,
  onOpenCollection,
  selecting,
  selectedIds,
  onSelect,
  onRemove,
  onToggleStar,
  onUpdateMetadata,
  onToggleSelect,
  getDragIds,
  onDropBooksOnCollection,
  openingBookId,
  className,
}: ShelfProps) {
  return (
    <div className={cn(layout === "list" ? "space-y-8" : "space-y-12", className)}>
      {sections.map((section, index) => (
        <section key={section.label || `section-${index}`}>
          {section.label && <Eyebrow className="mb-4 block">{section.label}</Eyebrow>}
          <SectionBody
            entries={section.entries}
            layout={layout}
            pendingBookIds={pendingBookIds}
            onOpenCollection={onOpenCollection}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onRemove={onRemove}
            onToggleStar={onToggleStar}
            onUpdateMetadata={onUpdateMetadata}
            onToggleSelect={onToggleSelect}
            getDragIds={getDragIds}
            onDropBooksOnCollection={onDropBooksOnCollection}
            openingBookId={openingBookId}
          />
        </section>
      ))}
    </div>
  );
}
