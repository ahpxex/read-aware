import { useRef, type DragEvent } from "react";
import { CaretRight, FolderSimple } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import { useTranslation } from "../../../i18n";
import { dragCarriesBooks, readBookDragPayload } from "../lib/book-drag";
import { COLLECTION_STACK_DEPTH, type CollectionCover, type CollectionTileData } from "../lib/collection-tile-data";
import type { ShelfLayout } from "../lib/shelf-view";
import { PluginContextMenu } from "../../plugins/components/PluginContextMenu";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";

type CollectionTileProps = {
  data: CollectionTileData;
  layout: ShelfLayout;
  onOpen: () => void;
  /** Books dragged from the shelf were dropped on this collection. */
  onDropBooks?: (ids: string[]) => void;
};

/** How far each card behind sits up and to the right, in percent of the box. */
const STACK_STEP = 5;

/**
 * Member covers stacked as a small pile, each whole at the book aspect: the
 * front card at the bottom left, the ones behind stepping up and right. Fewer
 * members make a shallower pile, never an empty slot; an empty collection
 * shows a folder glyph in the same footprint.
 */
function CoverStack({ covers, compact, active }: { covers: CollectionCover[]; compact: boolean; active: boolean }) {
  const cards = covers.slice(0, COLLECTION_STACK_DEPTH);
  if (cards.length === 0)
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-mark border border-border bg-fill text-fg-subtle",
          active && "ring-2 ring-fg",
        )}
      >
        <FolderSimple size={compact ? 18 : 24} weight="regular" aria-hidden="true" />
      </div>
    );
  const depth = cards.length - 1;
  const size = `${100 - depth * STACK_STEP}%`;
  return (
    <div className="relative h-full w-full" aria-hidden="true">
      {/* Painted back to front so the first member lies on top. */}
      {cards
        .map((cover, index) => (
          <div
            key={cover.id}
            style={{
              width: size,
              height: size,
              left: `${index * STACK_STEP}%`,
              top: `${(depth - index) * STACK_STEP}%`,
            }}
            className={cn(
              // Bare like a book cover on the shelf: no outline. A soft shadow
              // lifts each card off the one behind it; the front card carries
              // the hover and drop state.
              "absolute overflow-hidden rounded-mark bg-fill",
              index < depth && "shadow-sm",
              index === 0 &&
                "transition-shadow pointer-fine:group-hover:shadow-md pointer-fine:group-focus-within:shadow-md",
              index === 0 && active && "ring-2 ring-fg",
            )}
          >
            {cover.coverUrl ? (
              <img src={cover.coverUrl} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <BookCoverPlaceholder title={cover.title} author={cover.author} format={cover.format} compact={compact} />
            )}
            {/* Cards behind recede toward the page, so the front cover leads. */}
            {index > 0 && <span className="absolute inset-0 bg-paper/40" />}
          </div>
        ))
        .reverse()}
    </div>
  );
}

/**
 * A collection rendered as a shelf peer — a stack of its covers on a book's
 * footprint, with its name and count beneath so it reads as a folder. Opens
 * the collection on click; accepts book drags from the shelf as a drop target.
 */
export function CollectionTile({ data, layout, onOpen, onDropBooks }: CollectionTileProps) {
  const { t } = useTranslation("shelf");
  const countLabel = t("books", { count: data.count });
  const [dragOver, setDragOver] = useLocalAtom(false);
  // enter/leave fire per DOM node crossed; the counter nets them out so the
  // highlight survives moving across the montage's children.
  const dragDepth = useRef(0);

  const dropProps = onDropBooks
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!dragCarriesBooks(event.dataTransfer)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!dragCarriesBooks(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDragLeave: (event: DragEvent) => {
          if (!dragCarriesBooks(event.dataTransfer)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        },
        onDrop: (event: DragEvent) => {
          if (!dragCarriesBooks(event.dataTransfer)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          const ids = readBookDragPayload(event.dataTransfer);
          if (ids.length > 0) onDropBooks(ids);
        },
      }
    : {};

  if (layout === "list") {
    return (
      <div className="flex min-w-0 items-center">
        {/* oxlint-disable-next-line react/forbid-elements -- collection list row that is also a drop target */}
        <button
          type="button"
          onClick={onOpen}
          {...dropProps}
          className={cn(
            "group flex min-w-0 flex-1 items-center gap-4 rounded-control px-2 py-2 text-left transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
            dragOver && "bg-fg/5 ring-1 ring-fg",
          )}
        >
          <div className="h-16 w-11 shrink-0">
            <CoverStack covers={data.covers} compact active={false} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-serif text-sm font-medium text-fg">{data.name}</span>
            <span className="mt-0.5 block font-sans text-[13px] tabular-nums text-fg-muted">{countLabel}</span>
          </div>
          <CaretRight size={16} weight="regular" aria-hidden="true" className="shrink-0 text-fg-subtle" />
        </button>
        <PluginContextMenu input={{ surface: "collection", collection: data }} />
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-32 justify-self-start sm:max-w-36 lg:max-w-44">
      {/* oxlint-disable-next-line react/forbid-elements -- collection cover card that is also a drop target */}
      <button
        type="button"
        onClick={onOpen}
        {...dropProps}
        className="group flex w-full flex-col text-left focus-visible:outline-none"
      >
        {/* The same footprint as a book cover, so the grid stays aligned. */}
        <div className="aspect-[2/3] w-full">
          <CoverStack covers={data.covers} compact={false} active={dragOver} />
        </div>
        <span className="mt-2 block truncate font-serif text-sm font-medium leading-tight text-fg">{data.name}</span>
        <span className="mt-0.5 block font-sans text-caption tabular-nums text-fg-muted">{countLabel}</span>
      </button>
      <PluginContextMenu input={{ surface: "collection", collection: data }} className="absolute right-1 top-1" />
    </div>
  );
}
