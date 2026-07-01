import { Plus, Prohibit } from "@phosphor-icons/react";
import { Button, Dialog, TextField } from "@read-aware/ui";
import { useLocalAtom } from "@read-aware/ui/state";
import { useTranslation } from "../../../i18n";
import type { Collection } from "../../library/lib/library-types";

type AddToCollectionDialogProps = {
  open: boolean;
  count: number;
  collections: Collection[];
  onClose: () => void;
  /** Assign the selected books to a collection (or null to ungroup them). */
  onAssign: (collectionId: string | null) => void;
  /** Create a new collection; returns it (or null on failure). */
  onCreate: (name: string) => Promise<Collection | null>;
};

/** Pick an existing collection, ungroup, or create a new one for the selection. */
export function AddToCollectionDialog({
  open,
  count,
  collections,
  onClose,
  onAssign,
  onCreate,
}: AddToCollectionDialogProps) {
  const { t } = useTranslation("shelf");
  const [name, setName] = useLocalAtom("");
  const [creating, setCreating] = useLocalAtom(false);

  function assign(collectionId: string | null) {
    onAssign(collectionId);
    onClose();
  }

  async function createAndAssign() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const collection = await onCreate(trimmed);
    setCreating(false);
    if (collection) {
      setName("");
      assign(collection.id);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("collectionDialog.title", { count })}
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label={t("collectionDialog.newLabel")}
              value={name}
              placeholder={t("collectionDialog.newPlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createAndAssign();
              }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void createAndAssign()}
            disabled={!name.trim() || creating}
          >
            <Plus size={15} weight="regular" aria-hidden="true" />
            {t("actions.create")}
          </Button>
        </div>

        {collections.length > 0 && (
          <div className="-mx-1 flex max-h-60 flex-col overflow-y-auto">
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => assign(collection.id)}
                className="truncate rounded-md px-2 py-2 text-left font-sans text-sm text-fg transition-colors hover:bg-fg/5"
              >
                {collection.name}
              </button>
            ))}
          </div>
        )}

        <div className="-mx-1 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => assign(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left font-sans text-sm text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg"
          >
            <Prohibit size={15} weight="regular" aria-hidden="true" />
            {t("collectionDialog.removeFromCollection")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
