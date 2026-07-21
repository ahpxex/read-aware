import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";

type TabItem = {
  label: string;
  content: ReactNode;
};

type TabsProps = {
  items: TabItem[];
  defaultIndex?: number;
  /** Controlled active tab. When provided (with `onActiveIndexChange`), the
   *  parent owns selection — useful for persisting it or switching tabs
   *  programmatically. Omit for the default uncontrolled behavior. */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  variant?: "underline" | "pill" | "nav";
  ariaLabel?: string;
  stretch?: boolean;
  /** Fill the parent's height: the tab strip stays fixed and the active panel
   *  flexes to fill the remaining space (so its content can own scrolling).
   *  Without this, panels size to their content. */
  fill?: boolean;
  className?: string;
  /** Extra classes for the tab strip (`role="tablist"`) — e.g. horizontal
   *  padding to inset the labels while the underline rule stays full-width. */
  tabListClassName?: string;
  /** Actions rendered at the trailing edge of the tab strip row (e.g. the
   *  active panel's primary action). Not part of the tab order semantics. */
  trailing?: ReactNode;
};

export function Tabs({
  items,
  defaultIndex = 0,
  activeIndex: controlledIndex,
  onActiveIndexChange,
  variant = "underline",
  ariaLabel,
  stretch = false,
  fill = false,
  className,
  tabListClassName,
  trailing,
}: TabsProps) {
  const { t } = useTranslation("ui");
  const [internalIndex, setInternalIndex] = useLocalAtom(defaultIndex);
  const isControlled = controlledIndex != null;
  const activeIndex = isControlled ? controlledIndex : internalIndex;
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
    if (!isControlled) setInternalIndex(nextIndex);
    onActiveIndexChange?.(nextIndex);
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
    <div className={cn(fill && "flex h-full min-h-0 flex-col", className)}>
      <div
        ref={tabListRef}
        role="tablist"
        aria-label={ariaLabel ?? t("tabs")}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex",
          fill && "shrink-0",
          usesUnderlineIndicator && "relative",
          stretch && "w-full",
          (variant === "underline" || variant === "nav") && "gap-6 border-b border-border",
          variant === "pill" && "gap-1 rounded bg-fill p-1",
          tabListClassName,
        )}
      >
        {usesUnderlineIndicator && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -bottom-px left-0 h-0.5 bg-fg transition-[transform,width,opacity] duration-250 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
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
                "inline-flex items-center whitespace-nowrap font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                stretch && "flex-1 justify-center text-center",
                variant === "underline" &&
                  cn(
                    "pb-3",
                    isActive
                      ? "text-fg"
                      : "text-fg-muted hover:text-fg",
                  ),
                variant === "nav" &&
                  cn(
                    "pb-3",
                    isActive
                      ? "text-fg"
                      : "text-fg-subtle hover:text-fg",
                  ),
                variant === "pill" &&
                  cn(
                    "rounded px-3 py-1.5",
                    isActive
                      ? "bg-surface text-fg"
                      : "text-fg-muted hover:text-fg",
                  ),
              )}
            >
              {item.label}
            </button>
          );
        })}
        {trailing && (
          <div
            className={cn(
              "ml-auto flex items-center gap-2",
              // Underline/nav labels are a 20px line over pb-3; pull the (taller)
              // actions up so their text centers on the same 10px axis.
              usesUnderlineIndicator ? "-mt-1.5 self-start" : "self-center",
            )}
          >
            {trailing}
          </div>
        )}
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
              fill ? "min-h-0 flex-1 overflow-hidden" : "pt-4",
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
