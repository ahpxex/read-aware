import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type TagProps = {
  children: ReactNode;
  variant?: "default" | "outline";
  onRemove?: () => void;
  className?: string;
};

export function Tag({ children, variant = "default", onRemove, className }: TagProps) {
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
          aria-label="Remove"
          className="ml-0.5 text-stone-400 hover:text-stone-700"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      )}
    </span>
  );
}
