import { Button, Dialog, TextField } from "@read-aware/ui";
import { useLocalAtom } from "@read-aware/ui/state";
import { useTranslation } from "../../../i18n";

type NewCollectionDialogProps = {
  open: boolean;
  /** Books awaiting the new collection (drives the title's count). */
  count: number;
  onClose: () => void;
  /** Create the collection and assign the books; resolves true on success. */
  onCreate: (name: string) => Promise<boolean>;
};

/**
 * Names the collection a "new collection" drag-drop promised — the drop can't
 * carry a name, so the dialog collects it and the caller creates + assigns.
 */
export function NewCollectionDialog({ open, count, onClose, onCreate }: NewCollectionDialogProps) {
  const { t } = useTranslation("shelf");
  const [name, setName] = useLocalAtom("");
  const [creating, setCreating] = useLocalAtom(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const created = await onCreate(trimmed);
    setCreating(false);
    if (created) setName("");
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("dragDock.newCollectionTitle", { count })}>
      <div className="space-y-4">
        <TextField
          label={t("collection.nameLabel")}
          value={name}
          placeholder={t("collectionDialog.newPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!name.trim() || creating}>
            {t("actions.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
