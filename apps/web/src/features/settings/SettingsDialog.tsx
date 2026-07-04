import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  Database,
  Info,
  Keyboard,
  Palette,
  SlidersHorizontal,
  Sparkle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../i18n";
import { AboutPanel } from "./sections/AboutPanel";
import { AIPanel } from "./sections/AIPanel";
import { AppearancePanel } from "./sections/AppearancePanel";
import { DataSyncPanel } from "./sections/DataSyncPanel";
import { GeneralPanel } from "./sections/GeneralPanel";
import { ReadingPanel } from "./sections/ReadingPanel";
import { ShortcutsPanel } from "./sections/ShortcutsPanel";

type SectionId =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "shortcuts"
  | "dataSync"
  | "about";

type SettingsSection = {
  id: SectionId;
  icon: Icon;
  Panel: () => React.JSX.Element;
};

const SECTIONS: SettingsSection[] = [
  { id: "general", icon: SlidersHorizontal, Panel: GeneralPanel },
  { id: "appearance", icon: Palette, Panel: AppearancePanel },
  { id: "reading", icon: BookOpen, Panel: ReadingPanel },
  { id: "ai", icon: Sparkle, Panel: AIPanel },
  { id: "shortcuts", icon: Keyboard, Panel: ShortcutsPanel },
  { id: "dataSync", icon: Database, Panel: DataSyncPanel },
  { id: "about", icon: Info, Panel: AboutPanel },
];

const EXIT_DURATION_MS = 220;
const INDICATOR_HEIGHT = 18;

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation("settings");
  const titleId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isPresent, setIsPresent] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [indicatorY, setIndicatorY] = useState<number | null>(null);

  useEffect(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      setIsPresent(true);
      setIsClosing(false);
      return;
    }

    if (!isPresent) return;

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      setIsPresent(false);
      closeTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [open, isPresent]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPresent) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPresent, onClose]);

  // Slide the active-section indicator to the centre of the active nav item.
  useLayoutEffect(() => {
    if (!isPresent) return;
    const nav = navRef.current;
    const item = itemRefs.current[activeIndex];
    if (!nav || !item) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    setIndicatorY(itemRect.top - navRect.top + itemRect.height / 2 - INDICATOR_HEIGHT / 2);
  }, [activeIndex, isPresent]);

  function selectSection(index: number) {
    if (index === activeIndex) return;
    setDirection(index > activeIndex ? "forward" : "backward");
    setActiveIndex(index);
  }

  if (!isPresent) return null;

  const isVisible = open && !isClosing;
  const ActivePanel = SECTIONS[activeIndex].Panel;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/35 backdrop-blur-sm px-4 py-6 max-md:p-0 sm:p-8",
        "transition-[opacity,backdrop-filter] duration-220 ease-[var(--ra-ease-out-quart)] motion-reduce:transition-none",
        isVisible ? "opacity-100" : "opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex h-[min(85vh,42rem)] w-full max-w-3xl overflow-hidden rounded-md border border-border bg-[var(--ra-main-surface-color)] text-fg",
          // Phone: full-screen, sections as a horizontal top rail instead of
          // a side column.
          "max-md:h-full max-md:max-w-none max-md:flex-col max-md:rounded-none max-md:border-0",
          "transition-[opacity,transform] duration-260 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <nav
          ref={navRef}
          aria-label={t("dialog.sectionsLabel")}
          className={cn(
            "relative flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 p-3",
            "max-md:w-full max-md:flex-row max-md:items-center max-md:gap-1 max-md:overflow-x-auto max-md:overflow-y-visible max-md:border-r-0 max-md:border-b max-md:p-2 max-md:pt-[calc(0.5rem+var(--ra-safe-top))]",
          )}
        >
          <h2
            id={titleId}
            className="px-3 pb-2.5 pt-1.5 font-serif text-base font-medium text-fg max-md:shrink-0 max-md:p-0 max-md:px-2"
          >
            {t("dialog.title")}
          </h2>

          {/* Vertical position indicator — meaningless in the phone top rail
              (active state carries the emphasis there). */}
          {indicatorY != null && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1 top-0 w-[3px] rounded-full bg-fg transition-transform duration-300 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none max-md:hidden"
              style={{ height: INDICATOR_HEIGHT, transform: `translateY(${indicatorY}px)` }}
            />
          )}

          {SECTIONS.map((section, index) => {
            const active = index === activeIndex;
            const SectionIcon = section.icon;
            return (
              <button
                key={section.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectSection(index)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-left font-sans text-sm transition-colors",
                  "max-md:shrink-0 max-md:gap-1.5 max-md:px-2.5",
                  active ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <SectionIcon
                  size={16}
                  weight={active ? "fill" : "regular"}
                  aria-hidden="true"
                  className="shrink-0"
                />
                {t(`sections.${section.id}`)}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <IconButton
              label={t("dialog.close")}
              size="sm"
              onClick={onClose}
              icon={<X size={14} weight="regular" aria-hidden="true" />}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div
              key={activeIndex}
              className={cn(
                direction === "forward"
                  ? "ra-motion-tab-panel-in-forward"
                  : "ra-motion-tab-panel-in-backward",
                "max-md:pb-[var(--ra-safe-bottom)]",
              )}
            >
              <ActivePanel />
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
