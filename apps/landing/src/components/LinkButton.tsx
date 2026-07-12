import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@read-aware/ui/cn";

// An anchor styled to match the design-system `Button`. The shipped `Button` is
// a plain <button> (no polymorphic `as`), but downloads and external links need
// real <a> elements — this mirrors Button's look for those cases only.

const variantClasses = {
  solid: "bg-fg text-inverse-fg px-4 hover:bg-fg/90 active:bg-fg/80",
  outline:
    "border border-border-strong text-fg px-4 hover:border-fg-subtle hover:bg-fg/5 active:bg-fg/10",
} as const;

const sizeClasses = {
  sm: "text-sm h-8 gap-1.5",
  md: "text-sm h-9 gap-2",
  lg: "text-base h-10 gap-2",
} as const;

type LinkButtonProps = {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
  children: ReactNode;
} & AnchorHTMLAttributes<HTMLAnchorElement>;

export function LinkButton({
  variant = "solid",
  size = "md",
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
