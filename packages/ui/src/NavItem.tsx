import { forwardRef, type ReactNode } from "react";
import { cn } from "./lib/cn";

type NavItemProps = {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
};

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(
  function NavItem({ active, onClick, children, className }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "bg-transparent p-0 pb-[calc(theme(spacing.4)+1px)] -mb-[calc(theme(spacing.4)+1px)] font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          active ? "text-fg" : "text-fg-subtle hover:text-fg",
          className,
        )}
      >
        {children}
      </button>
    );
  },
);

NavItem.displayName = "NavItem";
