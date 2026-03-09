import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type SidebarProps = {
  side?: "left" | "right";
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  className?: string;
};

export function Sidebar({
  side = "left",
  open,
  onClose,
  children,
  width = "w-72",
  className,
}: SidebarProps) {
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
        className={cn(
          "fixed top-0 z-50 h-full border-border bg-paper transition-transform duration-200",
          side === "left"
            ? "left-0 border-r"
            : "right-0 border-l",
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
