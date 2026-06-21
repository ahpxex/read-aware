import { Check, Rows, SlidersHorizontal, SquaresFour, type Icon } from "@phosphor-icons/react";
import { Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useAtom } from "jotai";
import { shelfViewAtom } from "../../../state/ui";
import type { ShelfGroup, ShelfLayout, ShelfSort } from "../lib/shelf-view";

const LAYOUT_OPTIONS: { value: ShelfLayout; label: string; icon: Icon }[] = [
  { value: "grid", label: "Grid", icon: SquaresFour },
  { value: "list", label: "List", icon: Rows },
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

const groupEyebrow = "mb-1.5 font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500";

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
      <div className="flex flex-col">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex items-center justify-between rounded-sm px-2 py-1.5 text-left font-sans text-sm transition-colors",
                active ? "text-stone-950" : "text-stone-600 hover:bg-stone-100/70 hover:text-stone-950",
              )}
            >
              <span>{option.label}</span>
              {active && <Check size={14} weight="bold" aria-hidden="true" />}
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
      triggerClassName="h-7 w-7 items-center justify-center text-stone-500 transition-colors hover:text-stone-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
      trigger={<SlidersHorizontal size={16} weight="regular" aria-hidden="true" />}
    >
      <div className="w-56 space-y-4">
        <div>
          <p className={groupEyebrow}>Layout</p>
          <div className="flex gap-1.5">
            {LAYOUT_OPTIONS.map(({ value, label, icon: LayoutIcon }) => {
              const active = view.layout === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setView({ ...view, layout: value })}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-stone-950 bg-stone-950 text-white"
                      : "border-border text-stone-600 hover:border-stone-300 hover:text-stone-950",
                  )}
                >
                  <LayoutIcon size={15} weight="regular" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <OptionRows
          label="Group by"
          value={view.group}
          options={GROUP_OPTIONS}
          onChange={(group) => setView({ ...view, group })}
        />
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
