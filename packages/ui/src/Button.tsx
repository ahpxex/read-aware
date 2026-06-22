import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./lib/cn";

const variantClasses = {
  solid: "bg-fg text-inverse-fg px-4 hover:bg-fg/90 active:bg-fg/80",
  outline:
    "border border-border-strong text-fg px-4 hover:border-fg-subtle hover:bg-fg/5 active:bg-fg/10",
  ghost: "text-fg-muted px-4 hover:text-fg hover:bg-fg/5 active:bg-fg/10",
  link: "text-fg p-0 hover:text-fg-muted underline-offset-4 hover:underline",
  danger: "bg-red-900 text-red-50 px-4 hover:bg-red-800 active:bg-red-900",
} as const;

const sizeClasses = {
  sm: "text-sm h-8 gap-1.5",
  md: "text-sm h-9 gap-2",
  lg: "text-base h-10 gap-2",
} as const;

type ButtonProps = {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "solid", size = "md", className, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
