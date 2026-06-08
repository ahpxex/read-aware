import { cn } from "./lib/cn";

type KbdProps = {
  children: React.ReactNode;
  className?: string;
};

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center border border-stone-300 bg-stone-100 px-1.5 font-mono text-[11px] text-stone-600",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
