import { useEffect, useRef, useState } from "react";
import { cn } from "./lib/cn";

type SliderProps = {
  /** Row label on the left, matched to ChoiceGroup's legend typography. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called once per gesture — on release, not per drag tick — so expensive
   * consumers (reader stylesheet reinjection) don't run mid-drag. */
  onChange: (value: number) => void;
  /** Formats the live value shown at the row's right edge and to AT. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
};

/**
 * A quiet single-value slider: native `<input type="range">` under a
 * label/value row, so keyboard and ARIA come for free. While dragging it
 * tracks an internal draft (the value label follows the thumb live); the
 * parent's `onChange` fires only on commit — the native `change` event,
 * which browsers fire on release for pointers and per step for keys.
 */
export function Slider({ label, value, min, max, step, onChange, formatValue, disabled, className }: SliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<number | null>(null);
  // The commit handler reads the newest onChange without re-subscribing.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => {
      setDraft(null);
      onChangeRef.current(Number(input.value));
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);
  const shown = draft ?? value;
  const text = formatValue ? formatValue(shown) : String(shown);
  return (
    <label className={cn("block", disabled && "opacity-50", className)}>
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-sans text-[13px] font-medium text-fg-muted">{label}</span>
        <span className="font-sans text-[13px] tabular-nums text-fg-subtle">{text}</span>
      </span>
      <input
        ref={inputRef}
        type="range"
        aria-label={label}
        aria-valuetext={text}
        value={shown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        className={cn(
          "h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          // Thin quiet track; the fill-strong token keeps it visible on paper.
          "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-fill-strong",
          "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-fill-strong",
          "[&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg",
          "[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg",
        )}
      />
    </label>
  );
}
