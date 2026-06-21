import { useRef, useEffect, useId, type ReactNode } from "react";
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
};

export function Popover({
  trigger,
  triggerLabel,
  triggerClassName,
  children,
  align = "left",
  className,
}: PopoverProps) {
  const [open, setOpen] = useLocalAtom(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;

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
  }, [open]);

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
            "absolute z-50 mt-2 min-w-[200px] border border-border bg-paper p-4 shadow-sm",
            align === "left" && "left-0",
            align === "right" && "right-0",
            align === "center" && "left-1/2 -translate-x-1/2",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
