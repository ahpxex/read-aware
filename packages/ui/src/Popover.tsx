import { useRef, useEffect, useId, useCallback, type ReactNode } from "react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";
import { useHorizontalViewportCollision } from "./lib/useHorizontalViewportCollision";
import { Tooltip } from "./Tooltip";

type PopoverProps = {
  trigger: ReactNode;
  /** Accessible name for the (otherwise unlabeled) trigger button. */
  triggerLabel?: string;
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
  triggerTooltip,
  triggerTooltipSide = "bottom",
  triggerTooltipAlign = "center",
  triggerClassName,
  children,
  align = "left",
  className,
  panelClassName,
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useLocalAtom(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const { floatingRef, positionStyle } = useHorizontalViewportCollision(open, align);

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
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => setOpen((o) => !o)}
      className={cn("inline-flex", triggerClassName)}
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
          style={positionStyle}
          className={cn(
            "absolute z-50 mt-2 w-max max-w-[calc(100vw-1rem)]",
            align === "center" && "-translate-x-1/2",
          )}
        >
          <div
            id={panelId}
            role="dialog"
            className={cn(
              "ra-motion-overlay-pop max-h-[calc(100dvh-3.5rem)] min-w-[200px] max-w-full overflow-y-auto rounded-md border border-border bg-[var(--ra-main-surface-color)] p-4",
              align === "left" && "origin-top-left",
              align === "right" && "origin-top-right",
              align === "center" && "origin-top",
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
