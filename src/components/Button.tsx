import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./lib/cn";

const variantClasses = {
  solid:
    "bg-stone-950 text-paper px-4 hover:bg-stone-800 active:bg-stone-900",
  outline:
    "border border-stone-300 text-stone-950 px-4 hover:border-stone-500 hover:bg-stone-950/5 active:bg-stone-950/10",
  ghost:
    "text-stone-500 px-4 hover:text-stone-950 hover:bg-stone-950/5 active:bg-stone-950/10",
  link: "text-stone-950 p-0 hover:text-stone-700 underline-offset-4 hover:underline",
  danger:
    "bg-red-900 text-paper px-4 hover:bg-red-800 active:bg-red-900",
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
          "inline-flex items-center justify-center font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950 disabled:pointer-events-none disabled:opacity-40",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
