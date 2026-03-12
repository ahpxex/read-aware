import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocalAtom } from "../state/local";
import { cn } from "./lib/cn";

type TabItem = {
  label: string;
  content: ReactNode;
};

type TabsProps = {
  items: TabItem[];
  defaultIndex?: number;
  variant?: "underline" | "pill" | "nav";
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
  const [activeIndex, setActiveIndex] = useLocalAtom(defaultIndex);
  const [transitionDirection, setTransitionDirection] = useLocalAtom<"forward" | "backward">("forward");
  const [indicatorStyle, setIndicatorStyle] = useLocalAtom({
    x: 0,
    width: 0,
    ready: false,
  });
  const id = useId();
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function activateIndex(nextIndex: number) {
    if (nextIndex === activeIndex) return;
    setTransitionDirection(nextIndex > activeIndex ? "forward" : "backward");
    setActiveIndex(nextIndex);
  }

  const usesUnderlineIndicator = variant === "underline" || variant === "nav";

  const updateIndicator = useCallback(() => {
    if (!usesUnderlineIndicator) {
      setIndicatorStyle((prev) => ({ ...prev, ready: false }));
      return;
    }

    const tabList = tabListRef.current;
    const activeTab = tabRefs.current[activeIndex];
    if (!tabList || !activeTab) return;

    const listRect = tabList.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setIndicatorStyle({
      x: tabRect.left - listRect.left,
      width: tabRect.width,
      ready: true,
    });
  }, [activeIndex, setIndicatorStyle, usesUnderlineIndicator]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator, items.length]);

  useEffect(() => {
    if (!usesUnderlineIndicator) return;
    const tabList = tabListRef.current;
    if (!tabList) return;

    const observer = new ResizeObserver(() => {
      updateIndicator();
    });
    observer.observe(tabList);
    tabRefs.current.forEach((tab) => {
      if (tab) observer.observe(tab);
    });

    window.addEventListener("resize", updateIndicator);
    return () => {
      window.removeEventListener("resize", updateIndicator);
      observer.disconnect();
    };
  }, [updateIndicator, usesUnderlineIndicator]);

  function moveFocus(index: number) {
    activateIndex(index);
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
        ref={tabListRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex",
          usesUnderlineIndicator && "relative",
          stretch && "w-full",
          (variant === "underline" || variant === "nav") && "gap-6 border-b border-border",
          variant === "pill" && "gap-1 rounded bg-stone-100 p-1",
        )}
      >
        {usesUnderlineIndicator && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -bottom-px left-0 h-0.5 bg-stone-950 transition-[transform,width,opacity] duration-250 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
              !indicatorStyle.ready && "opacity-0",
            )}
            style={{
              width: indicatorStyle.width,
              transform: `translateX(${indicatorStyle.x}px)`,
            }}
          />
        )}
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
              onClick={() => activateIndex(i)}
              className={cn(
                "inline-flex items-center whitespace-nowrap font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                stretch && "flex-1 justify-center text-center",
                variant === "underline" &&
                  cn(
                    "pb-3",
                    isActive
                      ? "text-stone-950"
                      : "text-stone-600 hover:text-stone-700",
                  ),
                variant === "nav" &&
                  cn(
                    "pb-3 text-eyebrow uppercase tracking-eyebrow",
                    isActive
                      ? "text-stone-950"
                      : "text-stone-400 hover:text-stone-950",
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
            className={cn(
              "pt-4",
              i === activeIndex &&
                (transitionDirection === "forward"
                  ? "ra-motion-tab-panel-in-forward"
                  : "ra-motion-tab-panel-in-backward"),
            )}
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}
