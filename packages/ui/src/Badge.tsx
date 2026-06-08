import { cn } from "./lib/cn";

const variantClasses = {
  default: "bg-stone-200 text-stone-700",
  outline: "border border-stone-300 text-stone-600",
  muted: "bg-stone-100 text-stone-500",
} as const;

type BadgeProps = {
  variant?: keyof typeof variantClasses;
  children: React.ReactNode;
  className?: string;
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 font-sans text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
