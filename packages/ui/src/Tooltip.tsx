import { useId, type ReactNode, Children, cloneElement, isValidElement } from "react";
import { cn } from "./lib/cn";

const sideClasses = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
} as const;

// Horizontal alignment for top/bottom tooltips (left/right sides center on the
// cross axis and ignore it). The tooltip box is always laid out (hidden via
// opacity), so a centered tooltip on a window-edge trigger would poke past the
// viewport — "start"/"end" pin it to the trigger's edge instead.
const alignClasses = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

type TooltipProps = {
  content: string;
  side?: keyof typeof sideClasses;
  align?: keyof typeof alignClasses;
  children: ReactNode;
  className?: string;
};

export function Tooltip({
  content,
  side = "top",
  align = "center",
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const tooltipId = `${id}-tooltip`;

  // Clone the child to inject aria-describedby
  const child = Children.only(children);
  const trigger =
    isValidElement<Record<string, unknown>>(child)
      ? cloneElement(child, { "aria-describedby": tooltipId } as Record<string, unknown>)
      : child;

  return (
    <span className={cn("group relative inline-flex", className)}>
      {trigger}
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          // pointer-coarse: touch has no hover, and a tap's lingering focus
          // would pin the tooltip open — suppress it entirely there.
          "pointer-events-none absolute z-50 whitespace-nowrap rounded bg-fg px-2 py-1 text-xs text-inverse-fg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:hidden",
          sideClasses[side],
          (side === "top" || side === "bottom") && alignClasses[align],
        )}
      >
        {content}
      </span>
    </span>
  );
}
