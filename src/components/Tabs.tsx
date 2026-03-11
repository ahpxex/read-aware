import { useState, useId, useRef, type ReactNode } from "react";
import { cn } from "./lib/cn";

type TabItem = {
  label: string;
  content: ReactNode;
};

type TabsProps = {
  items: TabItem[];
  defaultIndex?: number;
  variant?: "underline" | "pill";
  ariaLabel?: string;
  stretch?: boolean;
  className?: string;
};

export function Tabs({
  items,
  defaultIndex = 0,
  variant = "underline",
  ariaLabel = "Tabs",
  stretch = false,
  className,
}: TabsProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveFocus(index: number) {
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = (activeIndex + 1) % items.length;
        break;
      case "ArrowLeft":
        next = (activeIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    moveFocus(next);
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex",
          stretch && "w-full",
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
              ref={(el) => { tabRefs.current[i] = el; }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "inline-flex items-center whitespace-nowrap font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                stretch && "flex-1 justify-center text-center",
                variant === "underline" &&
                  cn(
                    "-mb-px border-b-2 pb-3",
                    isActive
                      ? "border-stone-950 text-stone-950"
                      : "border-transparent text-stone-600 hover:text-stone-700",
                  ),
                variant === "pill" &&
                  cn(
                    "rounded px-3 py-1.5",
                    isActive
                      ? "bg-paper text-stone-950"
                      : "text-stone-600 hover:text-stone-700",
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
