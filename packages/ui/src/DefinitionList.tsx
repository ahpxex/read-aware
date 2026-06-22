import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type DefinitionItem = {
  label: string;
  value: ReactNode;
};

type DefinitionListProps = {
  items: DefinitionItem[];
  columns?: 1 | 2 | 3;
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
  className,
}: DefinitionListProps) {
  return (
    <dl className={cn("grid gap-8 sm:gap-10", columnClasses[columns], className)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-sans text-[13px] font-medium text-fg-muted">
            {item.label}
          </dt>
          <dd className="mt-3 text-sm leading-7 text-fg">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
