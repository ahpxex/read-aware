import { type ReactNode, useEffect, useRef, useCallback } from "react";
import { cn } from "./lib/cn";

type SidebarProps = {
  side?: "left" | "right";
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  label: string;
  className?: string;
};

export function Sidebar({
  side = "left",
  open,
  onClose,
  children,
  width = "w-72",
  label,
  className,
}: SidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  // Focus trap + scroll lock + Escape
  useEffect(() => {
    if (!open) return;

    document.addEventListener("keydown", handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the sidebar on open
    const el = sidebarRef.current;
    if (el) {
      const focusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? el).focus();
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, handleKeyDown]);

  // Trap focus within sidebar
  useEffect(() => {
    if (!open) return;
    const el = sidebarRef.current;
    if (!el) return;

    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusables = el!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-stone-950/10"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        role="dialog"
        aria-label={label}
        aria-modal={open || undefined}
        className={cn(
          "fixed top-0 z-50 h-full border-border bg-paper outline-none transition-transform duration-200",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          open
            ? "translate-x-0"
            : side === "left"
              ? "-translate-x-full"
              : "translate-x-full",
          width,
          className,
        )}
        aria-hidden={!open}
      >
        {children}
      </aside>
    </>
  );
}
