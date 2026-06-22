import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "../lib/cn";

type CaptionProps<T extends ElementType = "span"> = {
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as">;

export function Caption<T extends ElementType = "span">({
  as,
  className,
  ...props
}: CaptionProps<T>) {
  const Tag = (as || "span") as ElementType;
  return (
    <Tag
      className={cn("font-sans text-caption text-fg-muted", className)}
      {...props}
    />
  );
}
