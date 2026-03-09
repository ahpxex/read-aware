import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./lib/cn";

const variantClasses = {
  default: "text-stone-950",
  ghost: "text-stone-500 hover:text-stone-950",
} as const;

const sizeClasses = {
  sm: "text-sm",
  md: "text-base",
} as const;

type ButtonProps = {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "default", size = "md", className, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center bg-transparent p-0 font-sans transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
