import { type ReactNode } from "react";
import { cn } from "./lib/cn";

const sideClasses = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
} as const;

type TooltipProps = {
  content: string;
  side?: keyof typeof sideClasses;
  children: ReactNode;
  className?: string;
};

export function Tooltip({
  content,
  side = "top",
  children,
  className,
}: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded bg-stone-950 px-2 py-1 text-xs text-paper opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          sideClasses[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
