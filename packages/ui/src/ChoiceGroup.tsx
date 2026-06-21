import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type ChoiceGroupProps<T extends string> = {
  /** Optional eyebrow label above the choices. */
  label?: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  className?: string;
};

/**
 * A quiet, single-select control: choices read as plain text, the active one
 * marked by weight + a hairline underline rather than a filled pill. Typography
 * carries the state — no boxes, no fills.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      {label && (
        <legend className="mb-2 font-sans text-[13px] font-medium text-stone-500">
          {label}
        </legend>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "group/choice relative inline-flex items-center gap-1.5 pb-1.5 font-sans text-sm transition-colors",
                active ? "text-stone-900" : "text-stone-400 hover:text-stone-700",
                // Hairline underline that only renders under the active choice.
                "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:rounded-full after:transition-colors",
                active ? "after:bg-stone-900" : "after:bg-transparent",
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
    </fieldset>
  );
}
