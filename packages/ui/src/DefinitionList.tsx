import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type DefinitionItem = {
  label: string;
  value: ReactNode;
};

type DefinitionListProps = {
  items: DefinitionItem[];
  columns?: 1 | 2 | 3;
  variant?: "stacked" | "inline";
  className?: string;
};

const columnClasses = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
} as const;

export function DefinitionList({
  items,
  columns = 1,
  variant = "stacked",
  className,
}: DefinitionListProps) {
  return (
    <dl
      className={cn(
        "grid",
        variant === "stacked" ? "gap-6 sm:gap-8" : "gap-x-6 gap-y-2",
        columnClasses[columns],
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            variant === "inline" && "grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-4",
          )}
        >
          <dt className="font-sans text-[13px] font-medium text-fg-subtle">
            {item.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 text-sm text-fg",
              variant === "stacked" ? "mt-1.5 leading-6" : "leading-5",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
