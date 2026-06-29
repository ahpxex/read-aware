import { CaretRight, FolderSimple } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import type { ShelfLayout } from "../lib/shelf-view";

export type CollectionTileData = {
  id: string;
  name: string;
  count: number;
  /** Up to four member cover URLs for the montage (may be fewer). */
  coverUrls: string[];
};

type CollectionTileProps = {
  data: CollectionTileData;
  layout: ShelfLayout;
  onOpen: () => void;
};

/** A 2×2 montage of member covers, padded with blanks; a folder glyph when empty. */
function Montage({ coverUrls, className }: { coverUrls: string[]; className?: string }) {
  if (coverUrls.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-fg-subtle", className)}>
        <FolderSimple size={24} weight="regular" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={cn("grid grid-cols-2 grid-rows-2 gap-px", className)}>
      {Array.from({ length: 4 }).map((_, i) =>
        coverUrls[i] ? (
          <img key={i} src={coverUrls[i]} alt="" className="h-full w-full object-cover" />
        ) : (
          <div key={i} className="bg-fill-strong" />
        ),
      )}
    </div>
  );
}

/**
 * A collection rendered as a shelf peer — same footprint as a book, a montage of
 * its covers, and an always-on name/count label so it reads as a folder. Opens
 * the collection on click.
 */
export function CollectionTile({ data, layout, onOpen }: CollectionTileProps) {
  const countLabel = `${data.count} book${data.count === 1 ? "" : "s"}`;

  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-4 rounded-sm px-2 py-2 text-left transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-sm border border-border bg-fill">
          <Montage coverUrls={data.coverUrls} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-serif text-sm font-medium text-fg">{data.name}</span>
          <span className="mt-0.5 block font-sans text-[13px] tabular-nums text-fg-muted">
            {countLabel}
          </span>
        </div>
        <CaretRight size={16} weight="regular" aria-hidden="true" className="shrink-0 text-fg-subtle" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full max-w-32 justify-self-start flex-col text-left focus-visible:outline-none sm:max-w-36 lg:max-w-44"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm border border-border bg-fill transition-shadow group-hover:shadow-md group-focus-within:shadow-md">
        <Montage coverUrls={data.coverUrls} className="h-full w-full" />
        <div className="absolute inset-x-0 bottom-0 bg-stone-950/70 px-2 py-1.5">
          <span className="block truncate font-serif text-xs font-medium leading-tight text-white">
            {data.name}
          </span>
          <span className="mt-0.5 block font-sans text-[10px] tabular-nums text-white/70">
            {countLabel}
          </span>
        </div>
      </div>
    </button>
  );
}
