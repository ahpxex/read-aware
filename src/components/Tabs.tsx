import { useState, useId, type ReactNode } from "react";
import { cn } from "./lib/cn";

type TabItem = {
  label: string;
  content: ReactNode;
};

type TabsProps = {
  items: TabItem[];
  defaultIndex?: number;
  variant?: "underline" | "pill";
  className?: string;
};

export function Tabs({
  items,
  defaultIndex = 0,
  variant = "underline",
  className,
}: TabsProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const id = useId();

  return (
    <div className={className}>
      <div
        role="tablist"
        className={cn(
          "flex",
          variant === "underline" && "gap-6 border-b border-border",
          variant === "pill" && "gap-1 rounded bg-stone-100 p-1",
        )}
      >
        {items.map((item, i) => {
          const isActive = i === activeIndex;
          const tabId = `${id}-tab-${i}`;
          const panelId = `${id}-panel-${i}`;

          return (
            <button
              key={i}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                variant === "underline" &&
                  cn(
                    "-mb-px border-b-2 pb-3",
                    isActive
                      ? "border-stone-950 text-stone-950"
                      : "border-transparent text-stone-500 hover:text-stone-700",
                  ),
                variant === "pill" &&
                  cn(
                    "rounded px-3 py-1.5",
                    isActive
                      ? "bg-paper text-stone-950"
                      : "text-stone-500 hover:text-stone-700",
                  ),
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item, i) => {
        const tabId = `${id}-tab-${i}`;
        const panelId = `${id}-panel-${i}`;

        return (
          <div
            key={i}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            hidden={i !== activeIndex}
            className="pt-4"
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}
