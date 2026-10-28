import { useId, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "./lib/cn";

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type ChoiceGroupProps<T extends string> = {
  /** Optional eyebrow label above the choices. */
  label?: string;
  /** Accessible name when the visible legend is omitted. */
  ariaLabel?: string;
  value: T;
  options: ChoiceOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
  error?: string;
  /** `inline` reads as a row of words; `list` stacks full-width rows and
   * checks the active one, for longer option sets in narrow menus. */
  layout?: "inline" | "list";
};

/**
 * A quiet, single-select control: choices read as plain text, the active one
 * marked by weight + a hairline underline rather than a filled pill. Typography
 * carries the state — no boxes, no fills.
 */
export function ChoiceGroup<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  disabled = false,
  onChange,
  className,
  error,
  layout = "inline",
}: ChoiceGroupProps<T>) {
  const id = useId();
  return (
    <fieldset
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn("min-w-0 disabled:opacity-50", className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      {/* Floated so it lays out as an ordinary block: WebKit counts a rendered
          legend's height twice when the fieldset is a flex item, opening a
          gap under every group in a flex column. Still the fieldset's name. */}
      {label && (
        <legend className="float-left mb-2 w-full font-sans text-[13px] font-medium text-fg-muted">{label}</legend>
      )}
      <div
        className={cn(
          "clear-both",
          layout === "list" ? "-mx-1.5 flex flex-col" : "flex flex-wrap items-center gap-x-6 gap-y-2",
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          if (layout === "list")
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(option.value)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                  active ? "font-medium text-fg" : "text-fg-muted hover:bg-fg/5 hover:text-fg",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {option.icon && (
                    <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                      {option.icon}
                    </span>
                  )}
                  {option.label}
                </span>
                {active && <Check size={14} weight="bold" aria-hidden="true" className="text-fg-muted" />}
              </button>
            );
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "group/choice relative inline-flex items-center gap-1.5 pb-1.5 font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                active ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
                // Hairline underline that only renders under the active choice.
                "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:rounded-full after:transition-colors",
                active ? "after:bg-fg" : "after:bg-transparent",
              )}
            >
              {option.icon && (
                <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                  {option.icon}
                </span>
              )}
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] leading-tight text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
