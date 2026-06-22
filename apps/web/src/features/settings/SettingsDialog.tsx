import { useEffect, useId, useRef, useState } from "react";
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
import { AboutPanel } from "./sections/AboutPanel";
import { AIPanel } from "./sections/AIPanel";
import { AppearancePanel } from "./sections/AppearancePanel";
import { DataSyncPanel } from "./sections/DataSyncPanel";
import { GeneralPanel } from "./sections/GeneralPanel";
import { ReadingPanel } from "./sections/ReadingPanel";
import { ShortcutsPanel } from "./sections/ShortcutsPanel";

type SettingsSection = {
  label: string;
  icon: Icon;
  Panel: () => React.JSX.Element;
};

const SECTIONS: SettingsSection[] = [
  { label: "General", icon: SlidersHorizontal, Panel: GeneralPanel },
  { label: "Appearance", icon: Palette, Panel: AppearancePanel },
  { label: "Reading", icon: BookOpen, Panel: ReadingPanel },
  { label: "AI", icon: Sparkle, Panel: AIPanel },
  { label: "Shortcuts", icon: Keyboard, Panel: ShortcutsPanel },
  { label: "Data & Sync", icon: Database, Panel: DataSyncPanel },
  { label: "About", icon: Info, Panel: AboutPanel },
];

const EXIT_DURATION_MS = 220;

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const titleId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const [isPresent, setIsPresent] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

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

  if (!isPresent) return null;

  const isVisible = open && !isClosing;
  const ActivePanel = SECTIONS[activeIndex].Panel;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/35 backdrop-blur-sm px-4 py-6 sm:p-8",
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
          "transition-[opacity,transform] duration-260 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <nav
          aria-label="Settings sections"
          className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 p-3"
        >
          <h2 id={titleId} className="px-3 pb-2.5 pt-1.5 font-serif text-base font-medium text-fg">
            Settings
          </h2>
          {SECTIONS.map((section, index) => {
            const active = index === activeIndex;
            const SectionIcon = section.icon;
            return (
              <button
                key={section.label}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-left font-sans text-sm transition-colors",
                  active ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-fg"
                  />
                )}
                <SectionIcon
                  size={16}
                  weight={active ? "fill" : "regular"}
                  aria-hidden="true"
                  className="shrink-0"
                />
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <IconButton
              label="Close settings"
              size="sm"
              onClick={onClose}
              icon={<X size={14} weight="regular" aria-hidden="true" />}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ActivePanel />
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
