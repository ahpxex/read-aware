import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "../lib/cn";

type EyebrowProps<T extends ElementType = "p"> = {
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as">;

export function Eyebrow<T extends ElementType = "p">({
  as,
  className,
  ...props
}: EyebrowProps<T>) {
  const Tag = (as || "p") as ElementType;
  return (
    <Tag
      className={cn(
        "font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-600",
        className,
      )}
      {...props}
    />
  );
}
