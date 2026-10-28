import {
  useRef,
  useEffect,
  useId,
  useCallback,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";
import { useHorizontalViewportCollision } from "./lib/useHorizontalViewportCollision";
import { Tooltip } from "./Tooltip";

type PopoverProps = {
  trigger: ReactNode;
  /** Accessible name for the (otherwise unlabeled) trigger button. */
  triggerLabel?: string;
  triggerDisabled?: boolean;
  triggerPressed?: boolean;
  /** Visible hover/focus tooltip for the trigger, matching the icon buttons in
   *  the same cluster. Wraps only the button, so the open panel doesn't trip it. */
  triggerTooltip?: string;
  /** Which side the trigger tooltip appears on (default "bottom"). */
  triggerTooltipSide?: "top" | "bottom" | "left" | "right";
  /** Horizontal alignment of the trigger tooltip (default "center"); use "end"
   *  for triggers at the window's right edge so the tooltip stays inside. */
  triggerTooltipAlign?: "start" | "center" | "end";
  /** Override the trigger button styling (defaults to a bare inline-flex). */
  triggerClassName?: string;
  children: ReactNode;
  align?: "left" | "right" | "center";
  /**
   * Which side of the trigger the panel opens on (default "auto"). "top"
   * serves triggers docked at the bottom of the screen, such as a phone's
   * bottom toolbar; the panel's height is then capped to the space above.
   * "auto" prefers below and flips up only when the content cannot fit below
   * and the space above is larger — Select's listbox rule. Either way the
   * panel is capped to the measured space so it never leaves the screen.
   */
  side?: "bottom" | "top" | "auto";
  className?: string;
  /** Extra classes for the floating panel itself (the `role="dialog"` element),
   *  as opposed to `className` which styles the inline-block trigger wrapper.
   *  Use this to make the panel the scroll container so its scrollbar sits at the
   *  panel edge rather than on an inset child. */
  panelClassName?: string;
  /** Controlled open state. Omit for uncontrolled (self-managed) behavior. */
  open?: boolean;
  /** Notified whenever the open state should change (both modes). */
  onOpenChange?: (open: boolean) => void;
};

export function Popover({
  trigger,
  triggerLabel,
  triggerDisabled,
  triggerPressed,
  triggerTooltip,
  triggerTooltipSide = "bottom",
  triggerTooltipAlign = "center",
  triggerClassName,
  children,
  align = "left",
  side = "auto",
  className,
  panelClassName,
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useLocalAtom(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const { floatingRef, positionStyle } = useHorizontalViewportCollision(open, align);
  const placement = useVerticalPlacement(open, containerRef, panelRef, side);
  const resolvedSide = placement?.side ?? (side === "top" ? "top" : "bottom");

  const setOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(open) : next;
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange, open, setInternalOpen],
  );

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Clicks inside body-portaled floating UI (e.g. a Select listbox opened
      // from within this popover) are logically inside, not a dismissal.
      if (target instanceof Element && target.closest("[data-ui-portal]")) return;
      setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, setOpen]);

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={triggerLabel}
      disabled={triggerDisabled}
      aria-pressed={triggerPressed}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => setOpen((o) => !o)}
      className={cn("inline-flex disabled:cursor-default disabled:opacity-50", triggerClassName)}
    >
      {trigger}
    </button>
  );

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      {triggerTooltip ? (
        <Tooltip content={triggerTooltip} side={triggerTooltipSide} align={triggerTooltipAlign}>
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}
      {open && (
        <div
          ref={floatingRef}
          style={{ ...positionStyle, maxHeight: placement ? `${placement.space}px` : undefined }}
          className={cn(
            "absolute z-50 flex w-max max-w-[calc(100vw-1rem)] flex-col",
            resolvedSide === "top" ? "bottom-full mb-2" : "mt-2",
            align === "center" && "-translate-x-1/2",
          )}
        >
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            className={cn(
              "min-h-0 min-w-[200px] max-w-full overflow-y-auto rounded-md border border-border bg-[var(--ra-main-surface-color)] p-4",
              resolvedSide === "top" ? "ra-motion-overlay-pop-up" : "ra-motion-overlay-pop",
              resolvedSide === "top"
                ? align === "left"
                  ? "origin-bottom-left"
                  : align === "right"
                    ? "origin-bottom-right"
                    : "origin-bottom"
                : align === "left"
                  ? "origin-top-left"
                  : align === "right"
                    ? "origin-top-right"
                    : "origin-top",
              panelClassName,
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/** Gap between the trigger and the panel (mt-2 / mb-2) plus viewport breathing room. */
const PANEL_GAP = 8;
const VIEWPORT_EDGE_GAP = 8;

type VerticalPlacement = { side: "top" | "bottom"; space: number };

/**
 * The side and height an open panel can actually use, measured against the
 * visible viewport. The measured space is applied to the flex wrapper rather
 * than the panel's own max-height, so a caller's `max-h-*` still counts and
 * the result is the minimum of content, the caller's cap, and the real space.
 * Re-measured on viewport changes (rotation, on-screen keyboard) and when the
 * panel's own content resizes.
 */
function useVerticalPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLDivElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
  side: "bottom" | "top" | "auto",
): VerticalPlacement | null {
  const [placement, setPlacement] = useState<VerticalPlacement | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const spaceAbove = Math.max(0, Math.floor(rect.top - viewportTop - PANEL_GAP - VIEWPORT_EDGE_GAP));
    const spaceBelow = Math.max(0, Math.floor(viewportBottom - rect.bottom - PANEL_GAP - VIEWPORT_EDGE_GAP));
    // What the panel wants: content height bounded by any max-h the caller
    // put on it — the wrapper constraint never reaches this property.
    const classCap = Number.parseFloat(getComputedStyle(panel).maxHeight);
    const desired = Math.min(panel.scrollHeight, Number.isFinite(classCap) ? classCap : Infinity);
    const resolved =
      side === "top" || (side === "auto" && spaceBelow < desired && spaceAbove > spaceBelow) ? "top" : "bottom";
    const space = resolved === "top" ? spaceAbove : spaceBelow;
    setPlacement((current) =>
      current && current.side === resolved && current.space === space ? current : { side: resolved, space },
    );
  }, [anchorRef, panelRef, side]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    measure();
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (panel) observer?.observe(panel);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open, measure, panelRef]);

  return placement;
}
