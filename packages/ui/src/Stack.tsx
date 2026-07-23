import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "./lib/cn";

const gapClasses = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const;

const alignClasses = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
} as const;

const justifyClasses = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

type StackProps<T extends ElementType = "div"> = {
  as?: T;
  direction?: "vertical" | "horizontal";
  gap?: keyof typeof gapClasses;
  align?: keyof typeof alignClasses;
  justify?: keyof typeof justifyClasses;
  wrap?: boolean;
} & Omit<ComponentPropsWithRef<T>, "as" | "direction" | "gap" | "align" | "justify" | "wrap">;

export function Stack<T extends ElementType = "div">({
  as,
  direction = "vertical",
  gap = "md",
  align = "stretch",
  justify = "start",
  wrap = false,
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
        alignClasses[align],
        justifyClasses[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    />
  );
}
