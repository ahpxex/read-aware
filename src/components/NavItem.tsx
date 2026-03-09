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
        "bg-transparent p-0 font-sans text-eyebrow font-medium uppercase tracking-eyebrow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
        active ? "text-stone-950" : "text-stone-500 hover:text-stone-950",
        className,
      )}
    >
      {children}
    </button>
  );
}
