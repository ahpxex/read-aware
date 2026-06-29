import { createPortal } from "react-dom";
import { FolderPlus, Trash } from "@phosphor-icons/react";
import { Button, IconButton, Tooltip } from "@read-aware/ui";
import { useLocalAtom } from "@read-aware/ui/state";
import type { Collection } from "../../library/lib/library-types";
import { AddToCollectionDialog } from "./AddToCollectionDialog";
import { BooksRemoveDialog } from "./BookDialogs";

type ShelfSelectionToolbarProps = {
  count: number;
  total: number;
  collections: Collection[];
  onSelectAll: () => void;
  onClear: () => void;
  onAssignCollection: (collectionId: string | null) => void;
  onCreateCollection: (name: string) => Promise<Collection | null>;
  /** Performs the removal of the selected books (already-confirmed). */
  onRemove: () => void;
  onDone: () => void;
};

/**
 * Batch-management bar for selection mode — a floating bar centered at the
 * bottom of the window. Rendered through a portal to `document.body` so its
 * `fixed` position resolves against the viewport rather than the shelf's
 * transformed (will-change) page-enter container. Holds the count,
 * select-all/clear, and bulk star/unstar/remove.
 */
export function ShelfSelectionToolbar({
  count,
  total,
  collections,
  onSelectAll,
  onClear,
  onAssignCollection,
  onCreateCollection,
  onRemove,
  onDone,
}: ShelfSelectionToolbarProps) {
  const [removeOpen, setRemoveOpen] = useLocalAtom(false);
  const [collectionOpen, setCollectionOpen] = useLocalAtom(false);
  const allSelected = total > 0 && count === total;
  const disabled = count === 0;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-[var(--ra-main-surface-color)] py-1.5 pl-4 pr-2 shadow-lg">
        <span className="text-sm font-medium text-fg tabular-nums">{count} selected</span>
        <button
          type="button"
          onClick={allSelected ? onClear : onSelectAll}
          className="ml-2 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          {allSelected ? "Clear" : "Select all"}
        </button>

        <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />

        <Tooltip content="Add to collection" side="top">
          <IconButton
            label="Add selected to collection"
            size="sm"
            disabled={disabled}
            onClick={() => setCollectionOpen(true)}
            icon={<FolderPlus size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
        <Tooltip content="Remove" side="top">
          <IconButton
            label="Remove selected"
            size="sm"
            disabled={disabled}
            onClick={() => setRemoveOpen(true)}
            className="hover:text-red-600"
            icon={<Trash size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>

        <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />

        <Button variant="ghost" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>

      <BooksRemoveDialog
        count={count}
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => {
          setRemoveOpen(false);
          onRemove();
        }}
      />

      <AddToCollectionDialog
        open={collectionOpen}
        count={count}
        collections={collections}
        onClose={() => setCollectionOpen(false)}
        onAssign={onAssignCollection}
        onCreate={onCreateCollection}
      />
    </div>,
    document.body,
  );
}
