import { useId } from "react";
import { cn } from "./lib/cn";

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function Toggle({ label, checked, onChange, className }: ToggleProps) {
  const id = useId();
  const labelId = `${id}-label`;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
          checked ? "bg-stone-950" : "bg-stone-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-paper transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
      <span
        id={labelId}
        className="font-sans text-sm text-stone-700 select-none cursor-pointer"
        onClick={() => onChange(!checked)}
      >
        {label}
      </span>
    </div>
  );
}
