import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "../lib/cn";

const sizeClasses = {
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
} as const;

type HeadingSize = keyof typeof sizeClasses;

type HeadingProps<T extends ElementType = "h2"> = {
  as?: T;
  size?: HeadingSize;
} & Omit<ComponentPropsWithRef<T>, "as" | "size">;

export function Heading<T extends ElementType = "h2">({
  as,
  size = "2xl",
  className,
  ...props
}: HeadingProps<T>) {
  const Tag = (as || "h2") as ElementType;
  return (
    <Tag
      className={cn(
        "font-sans font-semibold tracking-tight text-stone-950",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
