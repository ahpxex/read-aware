import { PencilSimple, Trash } from "@phosphor-icons/react";
import { Body, Button, Dialog, Heading, IconButton, Tooltip } from "@read-aware/ui";
import { useLocalAtom } from "@read-aware/ui/state";
import type { Collection } from "../../library/lib/library-types";

type CollectionHeaderProps = {
  collection: Collection;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
};

/**
 * Header for a single collection view: the collection name (renamed inline), the
 * book count, and a delete action. Back to the shelf lives in the app header.
 * Mount with a `key` of the collection id so the inline draft resets per group.
 */
export function CollectionHeader({ collection, count, onRename, onDelete }: CollectionHeaderProps) {
  const [editing, setEditing] = useLocalAtom(false);
  const [draft, setDraft] = useLocalAtom(collection.name);
  const [deleteOpen, setDeleteOpen] = useLocalAtom(false);

  function commit() {
    const next = draft.trim();
    if (next && next !== collection.name) onRename(next);
    setEditing(false);
  }

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(collection.name);
                setEditing(false);
              }
            }}
            aria-label="Collection name"
            className="min-w-0 flex-1 border-b border-border-strong bg-transparent font-serif text-2xl text-fg outline-none"
          />
        ) : (
          <Heading size="2xl" className="min-w-0 truncate">
            {collection.name}
          </Heading>
        )}
        {!editing && (
          <Tooltip content="Rename" side="bottom">
            <IconButton
              label="Rename collection"
              size="sm"
              onClick={() => {
                setDraft(collection.name);
                setEditing(true);
              }}
              icon={<PencilSimple size={16} weight="regular" aria-hidden="true" />}
            />
          </Tooltip>
        )}
        <Tooltip content="Delete collection" side="bottom">
          <IconButton
            label="Delete collection"
            size="sm"
            className="hover:text-red-600"
            onClick={() => setDeleteOpen(true)}
            icon={<Trash size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      </div>

      <Body className="mt-1 text-sm tabular-nums text-fg-muted">
        {count} book{count === 1 ? "" : "s"}
      </Body>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete collection?">
        <div className="space-y-4">
          <p>
            Delete <strong>{collection.name}</strong>? The books stay in your library — they’re just
            ungrouped.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
