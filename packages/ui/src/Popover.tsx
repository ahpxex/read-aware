import { useRef, useEffect, useId, useCallback, type ReactNode } from "react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";

type PopoverProps = {
  trigger: ReactNode;
  /** Accessible name for the (otherwise unlabeled) trigger button. */
  triggerLabel?: string;
  /** Override the trigger button styling (defaults to a bare inline-flex). */
  triggerClassName?: string;
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Controlled open state. Omit for uncontrolled (self-managed) behavior. */
  open?: boolean;
  /** Notified whenever the open state should change (both modes). */
  onOpenChange?: (open: boolean) => void;
};

export function Popover({
  trigger,
  triggerLabel,
  triggerClassName,
  children,
  align = "left",
  className,
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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
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
      {open && (
        <div
          id={panelId}
          role="dialog"
          className={cn(
            "ra-motion-overlay-pop absolute z-50 mt-2 min-w-[200px] rounded-md border border-border bg-[var(--ra-main-surface-color)] p-4",
            align === "left" && "left-0 origin-top-left",
            align === "right" && "right-0 origin-top-right",
            align === "center" && "left-1/2 -translate-x-1/2 origin-top",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
