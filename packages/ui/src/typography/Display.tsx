import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "../lib/cn";

const sizeClasses = {
  "5xl": "text-5xl",
  "6xl": "text-6xl",
  "7xl": "text-7xl",
} as const;

type DisplaySize = keyof typeof sizeClasses;

type DisplayProps<T extends ElementType = "h1"> = {
  as?: T;
  size?: DisplaySize;
} & Omit<ComponentPropsWithRef<T>, "as" | "size">;

export function Display<T extends ElementType = "h1">({
  as,
  size = "7xl",
  className,
  ...props
}: DisplayProps<T>) {
  const Tag = (as || "h1") as ElementType;
  return (
    <Tag
      className={cn(
        "font-serif leading-display tracking-tight text-fg",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
