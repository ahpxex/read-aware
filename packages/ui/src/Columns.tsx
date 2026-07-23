import { type CSSProperties, type ReactNode } from "react";
import { cn } from "./lib/cn";

const gapClasses = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const;

const alignClasses = {
  start: "items-start",
  center: "items-center",
  baseline: "items-baseline",
  stretch: "items-stretch",
} as const;

const minWidthClasses = {
  compact: "min-w-[8rem]",
  standard: "min-w-[12rem]",
  wide: "min-w-[18rem]",
} as const;

type ColumnsProps = {
  children: ReactNode;
  gap?: keyof typeof gapClasses;
  align?: keyof typeof alignClasses;
  className?: string;
};

type ColumnProps = {
  children: ReactNode;
  weight?: number;
  minWidth?: keyof typeof minWidthClasses;
  className?: string;
};

/**
 * Container-responsive columns owned by the design system. Columns wrap when
 * their minimum width no longer fits, so consumers never need viewport
 * breakpoints or raw flexbox controls.
 */
export function Columns({
  children,
  gap = "md",
  align = "start",
  className,
}: ColumnsProps) {
  return (
    <div className={cn("flex flex-wrap", gapClasses[gap], alignClasses[align], className)}>
      {children}
    </div>
  );
}

function Column({
  children,
  weight = 1,
  minWidth = "standard",
  className,
}: ColumnProps) {
  const safeWeight = Number.isFinite(weight) ? Math.max(0.25, weight) : 1;
  const style = { "--ra-column-weight": safeWeight } as CSSProperties;

  return (
    <div
      className={cn(
        "min-w-0 basis-0 flex-[var(--ra-column-weight)]",
        minWidthClasses[minWidth],
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

Columns.Item = Column;
