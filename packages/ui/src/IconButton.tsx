import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

const sizeClasses = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
} as const;

type IconButtonProps = {
  icon: ReactNode;
  label: string;
  size?: keyof typeof sizeClasses;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, size = "md", className, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center bg-transparent text-stone-500 transition-colors hover:text-stone-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
