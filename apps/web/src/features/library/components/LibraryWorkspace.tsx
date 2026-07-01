import { useEffect, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Books } from "@phosphor-icons/react";
import { Alert, Body, Button, EmptyState } from "@read-aware/ui";
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
  error: string | null;
  notice?: string | null;
  books: LibraryBook[];
  collections: Collection[];
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
  error,
  notice,
  books,
  collections,
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
      {error && (
        <Alert variant="destructive" title={t("workspace.errorTitle")} className="mb-6">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert variant="default" title={t("workspace.importTitle")} className="mb-6">
          {notice}
        </Alert>
      )}

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
        <div className="flex flex-1 items-center justify-center py-16">
          <Body className="text-sm text-fg-muted">{t("workspace.loading")}</Body>
        </div>
      ) : books.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-16">
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
        <>
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
        </>
      )}
    </div>
  );
}
