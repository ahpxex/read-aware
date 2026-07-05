import { useRef, useEffect, useId, useCallback, type ReactNode } from "react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";

type DropdownItem = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
};

type DropdownMenuProps = {
  /** Omit to run fully controlled (e.g. a long-press-opened menu). */
  trigger?: ReactNode;
  items: DropdownItem[];
  align?: "left" | "right";
  className?: string;
  /** Controlled open state; leave undefined for internal (trigger-driven) state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function DropdownMenu({
  trigger,
  items,
  align = "left",
  className,
  open: controlledOpen,
  onOpenChange,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useLocalAtom(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const [activeIndex, setActiveIndex] = useLocalAtom(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const menuId = `${id}-menu`;

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [isControlled],
  );

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  // Focus active item
  useEffect(() => {
    if (open && activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [open, activeIndex]);

  function findNextEnabled(from: number, direction: 1 | -1): number {
    let idx = from;
    for (let i = 0; i < items.length; i++) {
      idx = (idx + direction + items.length) % items.length;
      if (!items[idx].disabled) return idx;
    }
    return from;
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(findNextEnabled(-1, 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(findNextEnabled(items.length, -1));
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => findNextEnabled(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => findNextEnabled(i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(findNextEnabled(-1, 1));
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(findNextEnabled(items.length, -1));
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close();
        break;
    }
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      {trigger != null && (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            if (open) {
              close();
            } else {
              setOpen(true);
              setActiveIndex(findNextEnabled(-1, 1));
            }
          }}
          onKeyDown={handleTriggerKeyDown}
          className="inline-flex"
        >
          {trigger}
        </button>
      )}
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className={cn(
            "ra-motion-overlay-pop absolute z-50 mt-1.5 min-w-[184px] max-w-[calc(100vw-1rem)] rounded-md border border-border bg-[var(--ra-main-surface-color)] p-1",
            align === "left" ? "left-0 origin-top-left" : "right-0 origin-top-right",
          )}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="menuitem"
              tabIndex={i === activeIndex ? 0 : -1}
              disabled={item.disabled}
              onClick={() => {
                item.onClick();
                close();
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
                item.destructive
                  ? cn(
                      "text-red-700 dark:text-red-400",
                      i === activeIndex
                        ? "bg-red-50 dark:bg-red-500/15"
                        : "hover:bg-red-50 focus:bg-red-50 dark:hover:bg-red-500/15 dark:focus:bg-red-500/15",
                    )
                  : cn("text-fg-muted", i === activeIndex ? "bg-fill text-fg" : "hover:bg-fill focus:bg-fill"),
                item.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {item.icon && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle">
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
