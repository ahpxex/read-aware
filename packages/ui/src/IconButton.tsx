import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

const sizeClasses = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  // An equal-width slot of a phone toolbar: the whole slot is the target,
  // at least 44px tall (the platform's minimum touch target).
  toolbar: "h-11 w-full min-w-0",
  // A frameless window's caption slot: the header's full height at the
  // 44px width Windows uses, with the hover fill of native caption buttons.
  caption: "h-full w-11 rounded-none hover:bg-fg/8 focus-visible:ring-inset",
} as const;

const toneClasses = {
  default: "text-fg-muted hover:text-fg",
  danger: "text-red-800 hover:bg-red-50 hover:text-red-950 active:bg-red-100",
  // The caption close button fills red on hover, the platform convention.
  close: "text-fg-muted hover:bg-red-600 hover:text-white",
} as const;

/**
 * IconButton's styling, for components that render their own button (a
 * Popover trigger) but must match the icon buttons beside them.
 */
export function iconButtonClassName({
  size = "md",
  tone = "default",
}: {
  size?: keyof typeof sizeClasses;
  tone?: keyof typeof toneClasses;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center rounded-md bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40",
    sizeClasses[size],
    toneClasses[tone],
  );
}

type IconButtonProps = {
  icon: ReactNode;
  label: string;
  size?: keyof typeof sizeClasses;
  tone?: keyof typeof toneClasses;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", tone = "default", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(iconButtonClassName({ size, tone }), className)}
      {...props}
    >
      {icon}
    </button>
  );
});
