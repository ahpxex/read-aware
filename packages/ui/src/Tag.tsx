import { type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "./lib/cn";

type TagProps = {
  children: ReactNode;
  variant?: "default" | "outline";
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

export function Tag({ children, variant = "default", onRemove, removeLabel, className }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-sans text-caption",
        variant === "default" && "bg-stone-100 px-2 py-0.5 text-stone-700",
        variant === "outline" && "border border-stone-200 px-2 py-0.5 text-stone-700",
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${typeof children === "string" ? children : ""}`}
          className="ml-0.5 text-stone-400 hover:text-stone-700"
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </span>
  );
}
