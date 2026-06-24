import { type ReactNode } from "react";
import { Check, Rows, SlidersHorizontal, SquaresFour } from "@phosphor-icons/react";
import { ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useAtom } from "jotai";
import { shelfViewAtom } from "../../../state/ui";
import type { ShelfGroup, ShelfLayout, ShelfSort } from "../lib/shelf-view";

const LAYOUT_OPTIONS: { value: ShelfLayout; label: string; icon: ReactNode }[] = [
  { value: "grid", label: "Grid", icon: <SquaresFour size={15} weight="regular" /> },
  { value: "list", label: "List", icon: <Rows size={15} weight="regular" /> },
];

const GROUP_OPTIONS: { value: ShelfGroup; label: string }[] = [
  { value: "none", label: "None" },
  { value: "status", label: "Reading status" },
  { value: "author", label: "Author" },
  { value: "format", label: "Format" },
];

const SORT_OPTIONS: { value: ShelfSort; label: string }[] = [
  { value: "recent", label: "Recently opened" },
  { value: "added", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "progress", label: "Progress" },
];

const groupEyebrow = "mb-1.5 font-sans text-[13px] font-medium text-fg-muted";

type OptionRowsProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

function OptionRows<T extends string>({ label, value, options, onChange }: OptionRowsProps<T>) {
  return (
    <div>
      <p className={groupEyebrow}>{label}</p>
      <div className="-mx-1.5 flex flex-col">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex items-center justify-between rounded-md px-1.5 py-1.5 text-left font-sans text-sm transition-colors",
                active ? "font-medium text-fg" : "text-fg-muted hover:bg-fg/5 hover:text-fg",
              )}
            >
              <span>{option.label}</span>
              {active && <Check size={14} weight="bold" aria-hidden="true" className="text-fg-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ShelfViewMenu() {
  const [view, setView] = useAtom(shelfViewAtom);

  return (
    <Popover
      align="right"
      triggerLabel="Shelf view"
      triggerClassName="h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      trigger={<SlidersHorizontal size={16} weight="regular" aria-hidden="true" />}
    >
      <div className="w-56">
        <ChoiceGroup
          label="Layout"
          value={view.layout}
          options={LAYOUT_OPTIONS}
          onChange={(layout) => setView({ ...view, layout })}
        />
        <Divider className="-mx-4 my-3" />
        <OptionRows
          label="Group by"
          value={view.group}
          options={GROUP_OPTIONS}
          onChange={(group) => setView({ ...view, group })}
        />
        <Divider className="-mx-4 my-3" />
        <OptionRows
          label="Sort by"
          value={view.sort}
          options={SORT_OPTIONS}
          onChange={(sort) => setView({ ...view, sort })}
        />
      </div>
    </Popover>
  );
}
