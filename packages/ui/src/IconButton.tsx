import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

const sizeClasses = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
} as const;

const toneClasses = {
  default: "text-fg-muted hover:text-fg",
  danger: "text-red-800 hover:bg-red-50 hover:text-red-950 active:bg-red-100",
} as const;

type IconButtonProps = {
  icon: ReactNode;
  label: string;
  size?: keyof typeof sizeClasses;
  tone?: keyof typeof toneClasses;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      label,
      size = "md",
      tone = "default",
      className,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40",
          sizeClasses[size],
          toneClasses[tone],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
