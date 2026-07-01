import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { BookFormat } from "../../library/lib/library-types";

type BookCoverPlaceholderProps = {
  title: string;
  author?: string;
  format?: BookFormat;
  className?: string;
};

/**
 * Monochrome, paper-toned surfaces (editorial restraint: stone palette only,
 * no gradients or color). A deterministic pick keyed on the title gives each
 * cover-less book a stable, recognizable tone — the point of a cover — without
 * a random network image (which is also blocked by the desktop CSP).
 */
const SURFACES = [
  { bg: "bg-stone-100", title: "text-stone-800", meta: "text-stone-500", rule: "bg-stone-300" },
  { bg: "bg-stone-200", title: "text-stone-800", meta: "text-stone-600", rule: "bg-stone-400" },
  { bg: "bg-paper-warm", title: "text-stone-700", meta: "text-stone-500", rule: "bg-stone-300" },
  { bg: "bg-stone-300", title: "text-stone-900", meta: "text-stone-600", rule: "bg-stone-400" },
  { bg: "bg-stone-700", title: "text-stone-50", meta: "text-stone-300", rule: "bg-stone-500" },
  { bg: "bg-stone-800", title: "text-stone-100", meta: "text-stone-400", rule: "bg-stone-600" },
] as const;

/** Stable djb2 hash so a given title always maps to the same surface. */
function surfaceForTitle(seed: string) {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0;
  }
  return SURFACES[hash % SURFACES.length];
}

export function BookCoverPlaceholder({
  title,
  author,
  format,
  className,
}: BookCoverPlaceholderProps) {
  const { t } = useTranslation("shelf");
  const surface = surfaceForTitle(title || "Untitled");

  return (
    <div
      role="img"
      aria-label={t("book.cover", { title })}
      className={cn(
        "flex h-full w-full select-none flex-col justify-between p-4",
        surface.bg,
        className,
      )}
    >
      {format && (
        <span
          className={cn(
            "font-sans text-[10px] font-medium uppercase tracking-wide",
            surface.meta,
          )}
        >
          {format}
        </span>
      )}

      <div className="flex min-h-0 flex-1 items-center">
        <span
          className={cn(
            "line-clamp-5 font-serif text-base font-medium leading-snug [text-wrap:balance]",
            surface.title,
          )}
        >
          {title}
        </span>
      </div>

      {author && (
        <div className="space-y-2">
          <div className={cn("h-px w-8", surface.rule)} />
          <span
            className={cn(
              "line-clamp-2 block font-sans text-[11px] leading-tight",
              surface.meta,
            )}
          >
            {author}
          </span>
        </div>
      )}
    </div>
  );
}
