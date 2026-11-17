import { useRef, type CSSProperties, type DragEvent, type ReactNode } from "react";
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

/**
 * How far each card behind sits up and to the right, in percent of the box:
 * a tight pile at rest, fanned out while a fine pointer hovers the tile.
 */
const STACK_STEP = 5;
const SPREAD_STEP = 10;

/** One card's box at a given step: the front card bottom left, each one behind up and right. */
function cardBox(index: number, depth: number, step: number) {
  return { left: `${index * step}%`, top: `${(depth - index) * step}%`, size: `${100 - depth * step}%` };
}

/**
 * Member covers stacked as a small pile, each whole at the book aspect. Fewer
 * members make a shallower pile, never an empty slot; an empty collection
 * shows a folder glyph in the same footprint. Fills its positioned box. With
 * `spreads`, the pile fans out while the tile is hovered or focused and every
 * card dims, so the veil follows the cards rather than the box; `front` lies
 * on the front card.
 */
function CoverStack({
  covers,
  compact,
  active,
  spreads = false,
  front,
}: {
  covers: CollectionCover[];
  compact: boolean;
  active: boolean;
  spreads?: boolean;
  front?: ReactNode;
}) {
  const cards = covers.slice(0, COLLECTION_STACK_DEPTH);
  if (cards.length === 0)
    return (
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden rounded-mark border border-border bg-fill text-fg-subtle",
          active && "ring-2 ring-fg",
        )}
      >
        <FolderSimple size={compact ? 18 : 24} weight="regular" aria-hidden="true" />
        {front}
      </div>
    );
  const depth = cards.length - 1;
  return (
    <div className="absolute inset-0">
      {/* Painted back to front so the first member lies on top. */}
      {cards
        .map((cover, index) => {
          const rest = cardBox(index, depth, STACK_STEP),
            spread = cardBox(index, depth, SPREAD_STEP);
          return (
            <div
              key={cover.id}
              style={
                {
                  "--rest-left": rest.left,
                  "--rest-top": rest.top,
                  "--rest-size": rest.size,
                  "--spread-left": spread.left,
                  "--spread-top": spread.top,
                  "--spread-size": spread.size,
                } as CSSProperties
              }
              className={cn(
                // Bare like a book cover on the shelf: no outline. A soft
                // shadow lifts each card off the one behind it.
                "absolute overflow-hidden rounded-mark bg-fill",
                "[left:var(--rest-left)] [top:var(--rest-top)] [width:var(--rest-size)] [height:var(--rest-size)]",
                spreads &&
                  depth > 0 &&
                  cn(
                    "transition-[left,top,width,height] duration-200 ease-out motion-reduce:transition-none",
                    "pointer-fine:group-hover:[left:var(--spread-left)] pointer-fine:group-hover:[top:var(--spread-top)]",
                    "pointer-fine:group-hover:[width:var(--spread-size)] pointer-fine:group-hover:[height:var(--spread-size)]",
                    "pointer-fine:group-focus-within:[left:var(--spread-left)] pointer-fine:group-focus-within:[top:var(--spread-top)]",
                    "pointer-fine:group-focus-within:[width:var(--spread-size)] pointer-fine:group-focus-within:[height:var(--spread-size)]",
                  ),
                index < depth && "shadow-sm",
                index === 0 && active && "ring-2 ring-fg",
              )}
            >
              <div className="h-full w-full" aria-hidden="true">
                {cover.coverUrl ? (
                  <img src={cover.coverUrl} alt="" draggable={false} className="h-full w-full object-cover" />
                ) : (
                  <BookCoverPlaceholder
                    title={cover.title}
                    author={cover.author}
                    format={cover.format}
                    compact={compact}
                  />
                )}
              </div>
              {/* Cards behind recede toward the page, so the front cover leads. */}
              {index > 0 && <span className="absolute inset-0 bg-paper/40" />}
              {spreads && index > 0 && <span className={VEIL} />}
              {index === 0 && front}
            </div>
          );
        })
        .reverse()}
    </div>
  );
}

/** The hover veil, the same dimming a book cover takes under its details. */
const VEIL =
  "pointer-events-none absolute inset-0 bg-stone-950/0 transition-colors pointer-fine:group-hover:bg-stone-950/75 pointer-fine:group-focus-within:bg-stone-950/75";

/**
 * The collection's details, worn like a book's: with a fine pointer they
 * appear on the front card, veiled like the cards behind it, on hover or
 * focus. Touch has no hover, so there the name and count ride a band along
 * the front cover's foot instead (`StackBand`) and are always there to read.
 */
function StackVeil({ name, count, titles }: { name: string; count: string; titles: string[] }) {
  return (
    <div
      className={cn(
        VEIL,
        "hidden flex-col justify-between p-3 opacity-0 transition-all pointer-fine:flex pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
      )}
    >
      <div className="min-w-0">
        <span className="line-clamp-3 font-serif text-sm font-medium leading-tight break-words text-white/95">
          {name}
        </span>
        <span className="mt-1 block font-sans text-[11px] tabular-nums text-white/70">{count}</span>
      </div>
      {titles.length > 0 && (
        <ul className="min-w-0 space-y-0.5">
          {titles.map((title, index) => (
            <li key={index} className="truncate font-sans text-[11px] text-white/70">
              {title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StackBand({ name, count }: { name: string; count: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-stone-950/70 px-2 py-1.5 pointer-fine:hidden">
      <span className="block truncate font-serif text-xs font-medium leading-tight text-white/95">{name}</span>
      <span className="mt-0.5 block font-sans text-[10px] tabular-nums text-white/70">{count}</span>
    </div>
  );
}

/**
 * A collection rendered as a shelf peer — a stack of its covers on exactly a
 * book's footprint, its name and count shown the way a book shows its title. Opens
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
          <div className="relative h-16 w-11 shrink-0">
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
        {/* Exactly a book cover's footprint, so the grid stays aligned. */}
        <div className="relative aspect-[2/3] w-full">
          <CoverStack
            covers={data.covers}
            compact={false}
            active={dragOver}
            spreads
            front={
              <>
                <StackVeil
                  name={data.name}
                  count={countLabel}
                  titles={data.covers.slice(0, COLLECTION_STACK_DEPTH).map((cover) => cover.title)}
                />
                <StackBand name={data.name} count={countLabel} />
              </>
            }
          />
        </div>
      </button>
      <PluginContextMenu input={{ surface: "collection", collection: data }} className="absolute right-1 top-1" />
    </div>
  );
}
