import { useEffect, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Books } from "@phosphor-icons/react";
import { Body, Button, EmptyState, Skeleton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { Shelf } from "../../shelf/components/Shelf";
import { CollectionHeader } from "../../shelf/components/CollectionHeader";
import type { CollectionTileData } from "../../shelf/components/CollectionTile";
import { ShelfSelectionToolbar } from "../../shelf/components/ShelfSelectionToolbar";
import { deriveShelfView } from "../../shelf/lib/derive-shelf-view";
import { useShelfSelection } from "../../shelf/hooks/useShelfSelection";
import { activeCollectionAtom, shelfViewAtom } from "../../../state/ui";
import type { BookMetadataPatch, Collection, LibraryBook } from "../lib/library-types";

type LibraryWorkspaceProps = {
  isReady: boolean;
  books: LibraryBook[];
  collections: Collection[];
  /** Book currently being opened (spinner feedback on its cover). */
  openingBookId?: string | null;
  onImport: () => void;
  onOpenBook: (book: LibraryBook) => void;
  onRemoveBook: (book: LibraryBook) => void;
  onToggleStar: (book: LibraryBook) => void;
  onUpdateBookMetadata: (book: LibraryBook, patch: BookMetadataPatch) => void;
  onBulkRemove: (ids: string[]) => void;
  onCreateCollection: (name: string) => Promise<Collection | null>;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
  onSetBooksCollection: (ids: string[], collectionId: string | null) => void;
};

export function LibraryWorkspace({
  isReady,
  books,
  collections,
  openingBookId,
  onImport,
  onOpenBook,
  onRemoveBook,
  onToggleStar,
  onUpdateBookMetadata,
  onBulkRemove,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onSetBooksCollection,
}: LibraryWorkspaceProps) {
  const { t } = useTranslation("shelf");
  const shelfView = useAtomValue(shelfViewAtom);
  const [activeCollectionId, setActiveCollectionId] = useAtom(activeCollectionAtom);
  const { active, ids, selectedIds, exit, clear, toggle, selectAll } = useShelfSelection();

  const activeCollection = activeCollectionId
    ? collections.find((c) => c.id === activeCollectionId) ?? null
    : null;

  // Pop back to the top level if the open collection was deleted.
  useEffect(() => {
    if (activeCollectionId && !collections.some((c) => c.id === activeCollectionId)) {
      setActiveCollectionId(null);
    }
  }, [activeCollectionId, collections, setActiveCollectionId]);

  // Leave selection mode if the library empties out from under it.
  useEffect(() => {
    if (active && books.length === 0) exit();
  }, [active, books.length, exit]);

  const visible = useMemo(
    () =>
      activeCollection
        ? books.filter((b) => b.collectionId === activeCollection.id)
        : books.filter((b) => !b.collectionId),
    [activeCollection, books],
  );

  const sections = deriveShelfView(visible, shelfView, t);

  // Collection tiles (top level only): true member counts and a cover montage.
  const collectionTiles: CollectionTileData[] = useMemo(() => {
    if (activeCollectionId) return [];
    const members = new Map<string, LibraryBook[]>();
    for (const book of books) {
      if (!book.collectionId) continue;
      const list = members.get(book.collectionId) ?? [];
      list.push(book);
      members.set(book.collectionId, list);
    }
    return collections.map((collection) => {
      const inside = members.get(collection.id) ?? [];
      return {
        id: collection.id,
        name: collection.name,
        count: inside.length,
        coverUrls: inside
          .map((b) => b.coverUrl)
          .filter((url): url is string => Boolean(url))
          .slice(0, 4),
      };
    });
  }, [activeCollectionId, books, collections]);

  const collectionCount = activeCollection
    ? books.filter((b) => b.collectionId === activeCollection.id).length
    : 0;

  return (
    <div
      className={cn(
        "ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col px-6 pt-5 sm:pt-6",
        // Extra bottom room so the floating selection bar never covers the last row.
        active ? "pb-28" : "pb-8 sm:pb-10",
      )}
    >
      {active && books.length > 0 && (
        <ShelfSelectionToolbar
          count={ids.length}
          total={visible.length}
          collections={collections}
          onSelectAll={() => selectAll(visible.map((book) => book.id))}
          onClear={clear}
          onAssignCollection={(collectionId) => {
            onSetBooksCollection(ids, collectionId);
            exit();
          }}
          onCreateCollection={onCreateCollection}
          onRemove={() => {
            onBulkRemove(ids);
            exit();
          }}
          onDone={exit}
        />
      )}

      {!isReady ? (
        // Skeleton shelf mirroring the real grid (see Shelf.tsx), so the load
        // reads as the shelf taking shape rather than a bare loading notice.
        <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 md:gap-x-6 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="space-y-2.5">
              <Skeleton variant="rectangular" className="aspect-[2/3] w-full rounded-sm" />
              <Skeleton variant="text" className="w-3/4" />
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="ra-motion-fade-in flex flex-1 items-center justify-center py-16">
          <EmptyState
            icon={<Books className="size-12 text-fg-subtle" weight="thin" />}
            title={t("workspace.emptyTitle")}
            action={(
              <Button size="sm" onClick={onImport}>
                {t("actions.import")}
              </Button>
            )}
          />
        </div>
      ) : (
        // Fades in over the skeleton it replaces (same grid geometry), so the
        // ready swap reads as the shelf resolving rather than a hard cut.
        <div className="ra-motion-fade-in">
          {activeCollection && (
            <CollectionHeader
              key={activeCollection.id}
              collection={activeCollection}
              count={collectionCount}
              onRename={(name) => onRenameCollection(activeCollection.id, name)}
              onDelete={() => {
                onDeleteCollection(activeCollection.id);
                setActiveCollectionId(null);
              }}
            />
          )}

          {visible.length === 0 && collectionTiles.length === 0 ? (
            <Body className="py-16 text-center text-sm text-fg-muted">
              {activeCollection ? t("workspace.emptyCollection") : t("workspace.nothingToShow")}
            </Body>
          ) : (
            <Shelf
              sections={sections}
              layout={shelfView.layout}
              collections={collectionTiles}
              openingBookId={openingBookId}
              onOpenCollection={(id) => setActiveCollectionId(id)}
              selecting={active}
              selectedIds={selectedIds}
              onSelect={onOpenBook}
              onRemove={onRemoveBook}
              onToggleStar={onToggleStar}
              onUpdateMetadata={onUpdateBookMetadata}
              onToggleSelect={(book) => toggle(book.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
