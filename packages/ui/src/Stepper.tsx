import { Minus, Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "./lib/cn";

type StepperProps = {
  /** Accessible name for the group, e.g. "Font Size". */
  label: string;
  /** The current value as read out between the two buttons. */
  valueText: string;
  onDecrement: () => void;
  onIncrement: () => void;
  /** False at the bottom of the range: the minus button disables. */
  canDecrement?: boolean;
  /** False at the top of the range: the plus button disables. */
  canIncrement?: boolean;
  decrementLabel: string;
  incrementLabel: string;
  /** Replace the default minus / plus glyphs (a reader uses a small and a large "A"). */
  decrementIcon?: ReactNode;
  incrementIcon?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * Step one value through an ordered range: two thumb-sized buttons at either
 * end with the current value between them. For settings people nudge rather
 * than pick (text size), where a row of every step is more to scan than to
 * use. Quiet like ChoiceGroup: glyphs and text, no box around them.
 */
export function Stepper({
  label,
  valueText,
  onDecrement,
  onIncrement,
  canDecrement = true,
  canIncrement = true,
  decrementLabel,
  incrementLabel,
  decrementIcon,
  incrementIcon,
  disabled = false,
  className,
}: StepperProps) {
  const button =
    "inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-35";
  return (
    <div role="group" aria-label={label} className={cn("flex items-center", disabled && "opacity-50", className)}>
      <button
        type="button"
        aria-label={decrementLabel}
        disabled={disabled || !canDecrement}
        onClick={onDecrement}
        className={button}
      >
        {decrementIcon ?? <Minus size={16} aria-hidden="true" />}
      </button>
      <output
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-center font-sans text-[13px] tabular-nums text-fg-muted"
      >
        {valueText}
      </output>
      <button
        type="button"
        aria-label={incrementLabel}
        disabled={disabled || !canIncrement}
        onClick={onIncrement}
        className={button}
      >
        {incrementIcon ?? <Plus size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
