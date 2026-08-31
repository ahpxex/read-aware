import { useRef, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderSimple, FolderSimplePlus, Prohibit, Trash } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import { useTranslation } from "../../../i18n";
import type { Collection } from "../../library/lib/library-types";
import { dragCarriesBooks, readBookDragPayload } from "../lib/book-drag";

type DockTargetProps = {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onDropBooks: (ids: string[]) => void;
};

/**
 * One drop zone in the dock. Enter/leave fire per DOM node crossed, so a depth
 * counter nets them out — the highlight must survive moving over the icon.
 */
function DockTarget({ icon, label, danger = false, onDropBooks }: DockTargetProps) {
  const [over, setOver] = useLocalAtom(false);
  const depth = useRef(0);

  return (
    <div
      onDragEnter={(event: DragEvent) => {
        if (!dragCarriesBooks(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event: DragEvent) => {
        if (!dragCarriesBooks(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event: DragEvent) => {
        if (!dragCarriesBooks(event.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event: DragEvent) => {
        if (!dragCarriesBooks(event.dataTransfer)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const ids = readBookDragPayload(event.dataTransfer);
        if (ids.length > 0) onDropBooks(ids);
      }}
      className={cn(
        "flex min-w-24 max-w-44 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-3 transition-colors",
        over
          ? danger
            ? "border-red-500 bg-red-500/10 text-red-600"
            : "border-fg bg-fg/5 text-fg"
          : "border-border-strong text-fg-muted",
      )}
    >
      {/* Drop targets swallow pointer events on children so enter/leave depth
          stays about DOM crossings, not hit-test quirks mid-drag. */}
      <span className="pointer-events-none" aria-hidden="true">{icon}</span>
      <span className="pointer-events-none w-full truncate text-center font-sans text-xs font-medium">
        {label}
      </span>
    </div>
  );
}

type ShelfDragDockProps = {
  /** Existing collections offered as direct drop targets. */
  collections: Collection[];
  /** Viewing inside a collection: offer "remove from collection". */
  inCollection?: boolean;
  onAssign: (ids: string[], collectionId: string | null) => void;
  onNewCollection: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
};

/**
 * Drop zones shown while a book drag is in flight — existing collections, a
 * new collection, and remove — floating where the selection toolbar sits (the
 * toolbar yields while dragging). Portaled to `document.body` so `fixed`
 * resolves against the viewport, not the shelf's transformed page-enter
 * container.
 */
export function ShelfDragDock({
  collections,
  inCollection = false,
  onAssign,
  onNewCollection,
  onDelete,
}: ShelfDragDockProps) {
  const { t } = useTranslation("shelf");

  return createPortal(
    <div className="fixed bottom-[calc(1.5rem+var(--ra-safe-bottom))] left-1/2 z-50 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2">
      <div className="ra-motion-fade-in flex flex-wrap items-stretch justify-center gap-2 rounded-xl border border-border bg-[var(--ra-main-surface-color)] p-2 shadow-lg">
        {collections.map((collection) => (
          <DockTarget
            key={collection.id}
            icon={<FolderSimple size={18} weight="regular" />}
            label={collection.name}
            onDropBooks={(ids) => onAssign(ids, collection.id)}
          />
        ))}
        <DockTarget
          icon={<FolderSimplePlus size={18} weight="regular" />}
          label={t("collectionDialog.newLabel")}
          onDropBooks={onNewCollection}
        />
        {inCollection && (
          <DockTarget
            icon={<Prohibit size={18} weight="regular" />}
            label={t("collectionDialog.removeFromCollection")}
            onDropBooks={(ids) => onAssign(ids, null)}
          />
        )}
        <DockTarget
          danger
          icon={<Trash size={18} weight="regular" />}
          label={t("actions.remove")}
          onDropBooks={onDelete}
        />
      </div>
    </div>,
    document.body,
  );
}
