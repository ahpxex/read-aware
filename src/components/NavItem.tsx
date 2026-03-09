import { cn } from "./lib/cn";

type NavItemProps = {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
};

export function NavItem({ active, onClick, children, className }: NavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "bg-transparent p-0 pb-[calc(theme(spacing.4)+1px)] -mb-[calc(theme(spacing.4)+1px)] border-b-2 font-sans text-eyebrow font-medium uppercase tracking-eyebrow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
        active
          ? "border-stone-950 text-stone-950"
          : "border-transparent text-stone-400 hover:text-stone-950",
        className,
      )}
    >
      {children}
    </button>
  );
}
