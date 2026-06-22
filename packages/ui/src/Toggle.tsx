import { useId } from "react";
import { cn } from "./lib/cn";

type ToggleProps = {
  /** Visible label rendered next to the switch. Omit for a label-less switch. */
  label?: string;
  /** Accessible name used when no visible `label` is rendered. */
  "aria-label"?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function Toggle({
  label,
  checked,
  onChange,
  className,
  "aria-label": ariaLabel,
}: ToggleProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hasLabel = Boolean(label);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={hasLabel ? labelId : undefined}
        aria-label={hasLabel ? undefined : ariaLabel}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          checked ? "bg-fg" : "bg-fill-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full transition-transform",
            checked ? "translate-x-[18px] bg-inverse-fg" : "translate-x-[3px] bg-white",
          )}
        />
      </button>
      {hasLabel && (
        <span
          id={labelId}
          className="font-sans text-sm text-fg select-none cursor-pointer"
          onClick={() => onChange(!checked)}
        >
          {label}
        </span>
      )}
    </div>
  );
}
