import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  CaretLeft,
  CaretRight,
  Database,
  Info,
  Keyboard,
  Palette,
  PuzzlePiece,
  SlidersHorizontal,
  Sparkle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useBackInterceptor } from "../../hooks/useBackInterceptor";
import { useTranslation } from "../../i18n";
import { settingsSectionRequestAtom, type SettingsSectionId } from "../../state/ui";
import { AboutPanel } from "./sections/AboutPanel";
import { AIPanel } from "./sections/AIPanel";
import { AppearancePanel } from "./sections/AppearancePanel";
import { DataSyncPanel } from "./sections/DataSyncPanel";
import { GeneralPanel } from "./sections/GeneralPanel";
import { PluginsPanel } from "./sections/PluginsPanel";
import { ReadingPanel } from "./sections/ReadingPanel";
import { ShortcutsPanel } from "./sections/ShortcutsPanel";

// Deep-linkable from anywhere via `settingsSectionRequestAtom` — the id union
// lives with the atom so requesters don't import the dialog.
type SectionId = SettingsSectionId;

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
  { id: "plugins", icon: PuzzlePiece, Panel: PluginsPanel },
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
  const isPhone = usePhoneViewport();
  const [isPresent, setIsPresent] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [indicatorY, setIndicatorY] = useState<number | null>(null);

  // Phone: two-level drill-in navigation — `null` shows the section list,
  // an index shows that section's panel. Reset to the list on every open.
  const [phoneSectionIndex, setPhoneSectionIndex] = useState<number | null>(null);
  // The list page only animates when returning from a panel, not on open.
  const returnedFromPanelRef = useRef(false);
  const [sectionRequest, setSectionRequest] = useAtom(settingsSectionRequestAtom);

  // Android back gesture: a drilled-in section is a deeper layer, so back
  // returns to the section list; at the list level the event falls through and
  // the app-level handler closes the dialog itself.
  useBackInterceptor(() => {
    if (!open || !isPhone || phoneSectionIndex == null) return false;
    returnedFromPanelRef.current = true;
    setPhoneSectionIndex(null);
    return true;
  });

  useEffect(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      setIsPresent(true);
      setIsClosing(false);
      setPhoneSectionIndex(null);
      returnedFromPanelRef.current = false;
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

  // Deep-link: land on the requested section (drilled straight in on phones).
  // Declared AFTER the open-reset effect above so it runs later in the same
  // commit — the reset's `setPhoneSectionIndex(null)` cannot undo the drill-in.
  // One-shot: clearing the atom re-runs this effect, which bails immediately.
  useEffect(() => {
    if (!open || !sectionRequest) return;
    const index = SECTIONS.findIndex((section) => section.id === sectionRequest);
    if (index >= 0) {
      setActiveIndex(index);
      if (isPhone) setPhoneSectionIndex(index);
    }
    setSectionRequest(null);
  }, [open, sectionRequest, isPhone, setSectionRequest]);

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
    if (!isPresent || isPhone) return;
    const nav = navRef.current;
    const item = itemRefs.current[activeIndex];
    if (!nav || !item) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    setIndicatorY(itemRect.top - navRect.top + itemRect.height / 2 - INDICATOR_HEIGHT / 2);
  }, [activeIndex, isPresent, isPhone]);

  function selectSection(index: number) {
    if (index === activeIndex) return;
    setDirection(index > activeIndex ? "forward" : "backward");
    setActiveIndex(index);
  }

  if (!isPresent) return null;

  const isVisible = open && !isClosing;

  if (isPhone) {
    const phoneSection = phoneSectionIndex != null ? SECTIONS[phoneSectionIndex] : null;
    const PhonePanel = phoneSection?.Panel;

    return (
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-[var(--ra-main-surface-color)]",
          "transition-opacity duration-220 ease-[var(--ra-ease-out-quart)] motion-reduce:transition-none",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex h-full w-full flex-col text-fg"
        >
          {/* Top bar: back (inside a section) + current title + close. */}
          <div
            className="flex shrink-0 items-center gap-1.5 border-b border-border/70"
            style={{
              height: "calc(3rem + var(--ra-safe-top))",
              paddingTop: "var(--ra-safe-top)",
              paddingLeft: "max(0.75rem, var(--ra-safe-left))",
              paddingRight: "max(0.75rem, var(--ra-safe-right))",
            }}
          >
            {phoneSection && (
              <IconButton
                label={t("dialog.title")}
                size="sm"
                onClick={() => {
                  returnedFromPanelRef.current = true;
                  setPhoneSectionIndex(null);
                }}
                className="shrink-0 text-fg-muted"
                icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
              />
            )}
            <h2
              id={titleId}
              className={cn(
                "min-w-0 flex-1 truncate font-serif text-base font-medium text-fg",
                !phoneSection && "pl-2",
              )}
            >
              {phoneSection ? t(`sections.${phoneSection.id}`) : t("dialog.title")}
            </h2>
            <IconButton
              label={t("dialog.close")}
              size="sm"
              onClick={onClose}
              className="shrink-0"
              icon={<X size={16} weight="regular" aria-hidden="true" />}
            />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {phoneSection && PhonePanel ? (
              <div
                key={phoneSection.id}
                className="ra-motion-tab-panel-in-forward pb-[var(--ra-safe-bottom)]"
              >
                <PhonePanel />
              </div>
            ) : (
              <nav
                key="section-list"
                aria-label={t("dialog.sectionsLabel")}
                className={cn(
                  "flex flex-col py-1 pb-[var(--ra-safe-bottom)]",
                  returnedFromPanelRef.current && "ra-motion-tab-panel-in-backward",
                )}
              >
                {SECTIONS.map((section, index) => {
                  const SectionIcon = section.icon;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setPhoneSectionIndex(index)}
                      className="flex items-center gap-3 border-b border-border/50 px-5 py-3.5 text-left transition-colors active:bg-fill"
                    >
                      <SectionIcon
                        size={18}
                        weight="regular"
                        aria-hidden="true"
                        className="shrink-0 text-fg-muted"
                      />
                      <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">
                        {t(`sections.${section.id}`)}
                      </span>
                      <CaretRight
                        size={14}
                        weight="regular"
                        aria-hidden="true"
                        className="shrink-0 text-fg-subtle"
                      />
                    </button>
                  );
                })}
              </nav>
            )}
          </ScrollArea>
        </section>
      </div>
    );
  }

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
          ref={navRef}
          aria-label={t("dialog.sectionsLabel")}
          className="relative flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 p-3"
        >
          <h2 id={titleId} className="px-3 pb-2.5 pt-1.5 font-serif text-base font-medium text-fg">
            {t("dialog.title")}
          </h2>

          {indicatorY != null && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1 top-0 w-[3px] rounded-full bg-fg transition-transform duration-300 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none"
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
              className={
                direction === "forward"
                  ? "ra-motion-tab-panel-in-forward"
                  : "ra-motion-tab-panel-in-backward"
              }
            >
              <ActivePanel />
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
