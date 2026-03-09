import { useState, useRef, useEffect, useId, useCallback, type ReactNode } from "react";
import { cn } from "./lib/cn";

type DropdownItem = {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type DropdownMenuProps = {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "left" | "right";
  className?: string;
};

export function DropdownMenu({ trigger, items, align = "left", className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const menuId = `${id}-menu`;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

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
  }, [open]);

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
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className={cn(
            "absolute z-50 mt-1 min-w-[160px] border border-border bg-paper py-1 shadow-sm",
            align === "left" ? "left-0" : "right-0",
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
                "w-full px-3 py-1.5 text-left text-sm outline-none",
                i === activeIndex && "bg-stone-100",
                item.destructive
                  ? "text-red-700 hover:bg-red-50 focus:bg-red-50"
                  : "text-stone-700 hover:bg-stone-100 focus:bg-stone-100",
                item.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
