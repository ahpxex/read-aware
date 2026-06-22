import { cn } from "./lib/cn";

const variantClasses = {
  default: "bg-fill-strong text-fg-muted",
  outline: "border border-border-strong text-fg-muted",
  muted: "bg-fill text-fg-subtle",
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
