import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "../lib/cn";

const sizeClasses = {
  base: "text-base",
  lg: "text-lg",
} as const;

type BodySize = keyof typeof sizeClasses;

type BodyProps<T extends ElementType = "p"> = {
  as?: T;
  size?: BodySize;
} & Omit<ComponentPropsWithRef<T>, "as" | "size">;

export function Body<T extends ElementType = "p">({
  as,
  size = "base",
  className,
  ...props
}: BodyProps<T>) {
  const Tag = (as || "p") as ElementType;
  return (
    <Tag
      className={cn(
        "font-sans leading-body text-stone-700",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
