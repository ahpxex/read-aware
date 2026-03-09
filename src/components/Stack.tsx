import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "./lib/cn";

const gapClasses = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const;

type StackProps<T extends ElementType = "div"> = {
  as?: T;
  direction?: "vertical" | "horizontal";
  gap?: keyof typeof gapClasses;
} & Omit<ComponentPropsWithRef<T>, "as" | "direction" | "gap">;

export function Stack<T extends ElementType = "div">({
  as,
  direction = "vertical",
  gap = "md",
  className,
  ...props
}: StackProps<T>) {
  const Tag = (as || "div") as ElementType;
  return (
    <Tag
      className={cn(
        "flex",
        direction === "vertical" ? "flex-col" : "flex-row",
        gapClasses[gap],
        className,
      )}
      {...props}
    />
  );
}
