import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  Children,
  cloneElement,
  isValidElement,
} from "react";
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

// The first hover waits before showing — a tooltip flashing on every
// incidental mouse pass reads as noise. But once one tooltip has shown,
// moving to a neighboring trigger shows its label immediately for a short
// grace period (the warm-group pattern of native toolbars): a user reading
// labels in sequence shouldn't re-pay the delay on every control.
// Module scope on purpose — warmth is shared across all Tooltip instances.
const SHOW_DELAY_MS = 550;
const WARM_GRACE_MS = 350;
let warmUntil = 0;

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
  // Hover visibility is state-driven (it carries the delay); keyboard focus
  // keeps the pure-CSS group-focus-within path below and shows immediately.
  const [hoverOpen, setHoverOpen] = useState(false);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    };
  }, []);

  function handleMouseEnter() {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    if (Date.now() < warmUntil) {
      setHoverOpen(true);
      return;
    }
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setHoverOpen(true);
    }, SHOW_DELAY_MS);
  }

  function handleMouseLeave() {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hoverOpen) warmUntil = Date.now() + WARM_GRACE_MS;
    setHoverOpen(false);
  }

  // Clone the child to inject aria-describedby
  const child = Children.only(children);
  const trigger =
    isValidElement<Record<string, unknown>>(child)
      ? cloneElement(child, { "aria-describedby": tooltipId } as Record<string, unknown>)
      : child;

  return (
    <span
      className={cn("group relative inline-flex", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          // pointer-coarse: touch has no hover, and a tap's lingering focus
          // would pin the tooltip open — suppress it entirely there.
          "pointer-events-none absolute z-50 whitespace-nowrap rounded bg-fg px-2 py-1 text-xs text-inverse-fg opacity-0 transition-opacity group-focus-within:opacity-100 pointer-coarse:hidden",
          hoverOpen && "opacity-100",
          sideClasses[side],
          (side === "top" || side === "bottom") && alignClasses[align],
        )}
      >
        {content}
      </span>
    </span>
  );
}
