import { useId } from "react";
import { cn } from "./lib/cn";

/** The two colors a swatch paints: its fill and the "Aa" set on it. */
export type SwatchColors = { background: string; foreground: string };

type SwatchOption<T extends string> = {
  value: T;
  label: string;
  colors: SwatchColors;
  /** A second pair painted on the right half, for a choice that follows
   *  something else (a page color that tracks light / dark mode). */
  alternate?: SwatchColors;
};

type SwatchGroupProps<T extends string> = {
  /** Optional label above the swatches. */
  label?: string;
  /** Accessible name when the visible label is omitted. */
  ariaLabel?: string;
  value: T;
  options: SwatchOption<T>[];
  disabled?: boolean;
  /** Names under the swatches. Off, the name is only announced (and shown
   *  on hover), for a row whose colors speak for themselves. */
  showLabels?: boolean;
  /** Spread the swatches across the row's width instead of packing them at
   *  its start (a row that overflows scrolls either way). */
  spread?: boolean;
  onChange: (value: T) => void;
  className?: string;
};

/**
 * A single-select row of color swatches, each a circle showing "Aa" in the
 * choice's own colors with its name beneath: for picking a color scheme by
 * how it looks rather than what it is called. The row scrolls sideways when
 * there are more swatches than fit. Selection is a ring, like ChoiceGroup's
 * underline: no fills beyond the swatches themselves.
 */
export function SwatchGroup<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  disabled = false,
  showLabels = true,
  spread = false,
  onChange,
  className,
}: SwatchGroupProps<T>) {
  const id = useId();
  return (
    <fieldset
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? `${id}-label` : undefined}
      disabled={disabled}
      className={cn("min-w-0 disabled:opacity-50", className)}
    >
      {label && (
        // Floated for the same WebKit flex-item legend gap as ChoiceGroup.
        <legend id={`${id}-label`} className="float-left mb-2 w-full font-sans text-[13px] font-medium text-fg-muted">
          {label}
        </legend>
      )}
      {/* Vertical padding leaves room for the selection outline inside the
          scroller, which would otherwise clip it. No scrollbar: a swatch cut
          off at the edge is the cue that the row goes on. */}
      <div
        className={cn(
          "-mx-1 clear-both flex gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          spread && "justify-between",
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              aria-label={showLabels ? undefined : option.label}
              title={showLabels ? undefined : option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                "group/swatch flex shrink-0 flex-col items-center gap-1.5 focus-visible:outline-none",
                showLabels && "w-16",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-border-strong",
                  // An outline, not a ring: its offset gap stays see-through,
                  // so it reads on whatever surface hosts the group.
                  "outline-offset-2 group-focus-visible/swatch:outline-1 group-focus-visible/swatch:outline-fg",
                  active && "outline-2 outline-fg",
                )}
                style={{ backgroundColor: option.colors.background }}
              >
                {option.alternate && (
                  <span
                    className="absolute inset-y-0 right-0 w-1/2"
                    style={{ backgroundColor: option.alternate.background }}
                  />
                )}
                <span className="relative font-serif text-[15px] leading-none">
                  <span style={{ color: option.colors.foreground }}>A</span>
                  <span style={{ color: (option.alternate ?? option.colors).foreground }}>a</span>
                </span>
              </span>
              {showLabels && (
                <span
                  className={cn(
                    "max-w-full truncate font-sans text-[11px] leading-tight",
                    active ? "text-fg" : "text-fg-subtle",
                  )}
                >
                  {option.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
