import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  CaretLeft,
  CaretRight,
  Database,
  Info,
  Keyboard,
  Palette,
  PuzzlePiece,
  Rows,
  SlidersHorizontal,
  Sparkle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useBackInterceptor } from "../../hooks/useBackInterceptor";
import { isIOS } from "../../platform/environment";
import { usePanelSwipeDismiss } from "../reader";
import { useTranslation } from "../../i18n";
import {
  activeSettingsSectionAtom,
  settingsSectionRequestAtom,
  workspaceSourcesAtom,
  type CoreSettingsSectionId,
  type SettingsSectionId,
} from "../../state/ui";
import {
  actorFromEvent,
  causalActor,
  mergeEventCauses,
  stampEventCause,
  type DomainActor,
} from "../../platform/domain-actor";
import { workspace } from "../../services/workspace";
import { installedPluginsAtom } from "../plugins/state/plugin-store";
import type { PluginManifest } from "../plugins/lib/plugin-types";
import { AboutPanel } from "./sections/AboutPanel";
import { PluginSettingsSectionPanel } from "./sections/PluginSettingsSectionPanel";
import { AIPanel } from "./sections/AIPanel";
import { AppearancePanel } from "./sections/AppearancePanel";
import { DataSyncPanel } from "./sections/DataSyncPanel";
import { GeneralPanel } from "./sections/GeneralPanel";
import { MenusPanel } from "./sections/MenusPanel";
import { ReadingPanel } from "./sections/ReadingPanel";
import { PluginsPanel } from "./sections/PluginsPanel";
import { ShortcutsPanel } from "./sections/ShortcutsPanel";

// Deep-linkable from anywhere via `settingsSectionRequestAtom` — the id union
// lives with the atom so requesters don't import the dialog. Panels exist for
// the CORE ids; `plugin:<id>` requests resolve against the entry list below.
type SectionId = CoreSettingsSectionId;

type SettingsSection = {
  id: SectionId;
  icon: Icon;
  Panel: () => React.JSX.Element;
};

// Three bands: what the product is (general/reading/ai/plugins), making it
// yours (theme/customize/shortcuts), then system & meta.
const SECTIONS: SettingsSection[] = [
  { id: "general", icon: SlidersHorizontal, Panel: GeneralPanel },
  { id: "reading", icon: BookOpen, Panel: ReadingPanel },
  { id: "ai", icon: Sparkle, Panel: AIPanel },
  { id: "plugins", icon: PuzzlePiece, Panel: PluginsPanel },
  { id: "appearance", icon: Palette, Panel: AppearancePanel },
  { id: "menus", icon: Rows, Panel: MenusPanel },
  { id: "shortcuts", icon: Keyboard, Panel: ShortcutsPanel },
  { id: "dataSync", icon: Database, Panel: DataSyncPanel },
  { id: "about", icon: Info, Panel: AboutPanel },
];

/**
 * The sidebar's full entry list: the core sections, then — after a divider —
 * one section per ENABLED plugin that declares settings. Plugins get real
 * settings tabs, not just a buried button on their Plugins-panel card.
 */
type NavEntry = { kind: "core"; section: SettingsSection } | { kind: "plugin"; manifest: PluginManifest };

const entryKey = (entry: NavEntry): SettingsSectionId =>
  entry.kind === "core" ? entry.section.id : `plugin:${entry.manifest.id}`;

const EXIT_DURATION_MS = 220;
const INDICATOR_HEIGHT = 18;

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  workspaceToken?: number;
};

export function SettingsDialog({ open, onClose, workspaceToken = 0 }: SettingsDialogProps) {
  const { t } = useTranslation("settings");
  const titleId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const phonePageRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isPhone = usePhoneViewport();
  const [isPresent, setIsPresent] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const workspaceSources = useAtomValue(workspaceSourcesAtom);
  const [activeNavigation, setActiveNavigation] = useState(() => stampEventCause({ index: 0 }, "system"));
  const activeIndex = activeNavigation.index;
  function setActiveIndex(index: number, source: DomainActor = "user") {
    setActiveNavigation(stampEventCause({ index }, causalActor(source)));
  }
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [indicatorY, setIndicatorY] = useState<number | null>(null);

  const installedPlugins = useAtomValue(installedPluginsAtom);
  const entries: NavEntry[] = [
    ...SECTIONS.map((section): NavEntry => ({ kind: "core", section })),
    ...installedPlugins
      .filter((plugin) => plugin.enabled && plugin.manifest.settings?.length)
      .map((plugin): NavEntry => ({ kind: "plugin", manifest: plugin.manifest })),
  ];
  const entryLabel = (entry: NavEntry) =>
    entry.kind === "core" ? t(`sections.${entry.section.id}`) : entry.manifest.name;

  // Phone: two-level drill-in navigation — `null` shows the section list,
  // an index shows that section's panel. Reset to the list on every open.
  const [phoneNavigation, setPhoneNavigation] = useState(() =>
    stampEventCause({ index: null as number | null }, "system"),
  );
  const phoneSectionIndex = phoneNavigation.index;
  function setPhoneSectionIndex(index: number | null, source: DomainActor = "user") {
    setPhoneNavigation(stampEventCause({ index }, causalActor(source)));
  }
  // The list page only animates when returning from a panel, not on open.
  const returnedFromPanelRef = useRef(false);
  const [sectionRequest, setSectionRequest] = useAtom(settingsSectionRequestAtom);

  function returnToSectionList() {
    returnedFromPanelRef.current = true;
    setPhoneSectionIndex(null);
  }

  usePanelSwipeDismiss(phonePageRef, {
    open: open && isPresent,
    enabled: isPhone && isIOS(),
    exit: "right",
    edgeOnly: true,
    navigationKey: phoneSectionIndex,
    onDismiss: () => {
      if (phoneSectionIndex !== null) returnToSectionList();
      else onClose();
    },
  });

  // Android back gesture: a drilled-in section is a deeper layer, so back
  // returns to the section list; at the list level the event falls through and
  // the app-level handler closes the dialog itself.
  useBackInterceptor(() => {
    if (!open || !isPhone || phoneSectionIndex == null) return false;
    returnToSectionList();
    return true;
  });

  // The opening actor is read when the dialog opens; a new source alone never resets it.
  const resetPhoneNavigation = useEffectEvent(() =>
    setPhoneSectionIndex(null, actorFromEvent(workspaceSources.settingsOpen)),
  );
  useEffect(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      setIsPresent(true);
      setIsClosing(false);
      resetPhoneNavigation();
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
  // Matches the full entry list, so `plugin:<id>` requests land on a plugin's
  // own section (entryKey of a core entry IS its section id).
  // Declared AFTER the open-reset effect above so it runs later in the same
  // commit — the reset's `setPhoneSectionIndex(null)` cannot undo the drill-in.
  // One-shot: clearing the atom re-runs this effect, which bails immediately.
  // `entries` and the layout are read as of the request; only a new request
  // (or opening with one pending) lands.
  const landOnRequestedSection = useEffectEvent((request: string) => {
    const source = actorFromEvent(workspaceSources.sectionRequest);
    const index = entries.findIndex((entry) => entryKey(entry) === request);
    if (index >= 0) {
      setActiveIndex(index, source);
      if (isPhone) setPhoneSectionIndex(index, source);
    }
    setSectionRequest(null, source);
  });
  useEffect(() => {
    if (open && sectionRequest) landOnRequestedSection(sectionRequest);
  }, [open, sectionRequest]);

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

  // A plugin toggling off can shrink the entry list under the active index.
  const safeActiveIndex = Math.min(activeIndex, entries.length - 1);
  const setActiveSection = useSetAtom(activeSettingsSectionAtom);
  const currentEntry = isPhone
    ? phoneSectionIndex === null
      ? null
      : entries[Math.min(phoneSectionIndex, entries.length - 1)]
    : entries[safeActiveIndex];
  const currentSection = open && isPresent && !isClosing && currentEntry ? entryKey(currentEntry) : null;
  const navigation = isPhone ? phoneNavigation : activeNavigation;
  const visible = open && isPresent && !isClosing;
  const publishedSection = useRef<{
    section: SettingsSectionId | null;
    visible: boolean;
    isPhone: boolean;
    navigation: typeof navigation;
    entries: NavEntry[];
  } | null>(null);
  useLayoutEffect(() => {
    const previous = publishedSection.current;
    if (!previous || previous.section !== currentSection) {
      const sources: object[] = [];
      if (!previous || previous.visible !== visible) sources.push(workspaceSources.settingsOpen);
      if (previous && previous.isPhone !== isPhone) sources.push(stampEventCause({}, "system"));
      if (previous && previous.navigation !== navigation && previous.isPhone === isPhone) sources.push(navigation);
      // Entry removal/reordering can change the selected panel without a click.
      // Only join that registry mutation when it changes this index's projection.
      if (previous && navigation.index !== null) {
        const oldEntry = previous.entries[Math.min(navigation.index, previous.entries.length - 1)];
        if (oldEntry && currentEntry && entryKey(oldEntry) !== entryKey(currentEntry)) sources.push(installedPlugins);
      }
      setActiveSection(currentSection, actorFromEvent(mergeEventCauses(sources, {})));
    }
    publishedSection.current = { section: currentSection, visible, isPhone, navigation, entries };
  });
  useLayoutEffect(() => {
    if (currentSection) workspace.acknowledge("settings", workspaceToken);
  }, [currentSection, workspaceToken]);

  // Slide the active-section indicator to the centre of the active nav item.
  useLayoutEffect(() => {
    if (!isPresent || isPhone) return;
    const nav = navRef.current;
    const item = itemRefs.current[safeActiveIndex];
    if (!nav || !item) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    setIndicatorY(itemRect.top - navRect.top + itemRect.height / 2 - INDICATOR_HEIGHT / 2);
  }, [safeActiveIndex, isPresent, isPhone]);

  function selectSection(index: number) {
    if (index === safeActiveIndex) return;
    setDirection(index > safeActiveIndex ? "forward" : "backward");
    setActiveIndex(index);
  }

  if (!isPresent) return null;

  const isVisible = open && !isClosing;

  /** Divider between core sections and per-plugin sections. */
  const isFirstPluginEntry = (index: number) =>
    entries[index]?.kind === "plugin" && entries[index - 1]?.kind === "core";

  if (isPhone) {
    const phoneEntry = phoneSectionIndex != null ? entries[Math.min(phoneSectionIndex, entries.length - 1)] : null;

    return (
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-[var(--ra-main-surface-color)]",
          "transition-opacity duration-220 ease-[var(--ra-ease-out-quart)] motion-reduce:transition-none",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <section
          ref={phonePageRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex h-full w-full flex-col bg-[var(--ra-main-surface-color)] text-fg"
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
            {phoneEntry && (
              <IconButton
                label={t("dialog.title")}
                size="sm"
                onClick={returnToSectionList}
                className="shrink-0 text-fg-muted"
                icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
              />
            )}
            <h2
              id={titleId}
              className={cn("min-w-0 flex-1 truncate font-serif text-base font-medium text-fg", !phoneEntry && "pl-2")}
            >
              {phoneEntry ? entryLabel(phoneEntry) : t("dialog.title")}
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
            {phoneEntry ? (
              <div key={entryKey(phoneEntry)} className="ra-motion-tab-panel-in-forward pb-[var(--ra-safe-bottom)]">
                {phoneEntry.kind === "core" ? (
                  <phoneEntry.section.Panel />
                ) : (
                  <PluginSettingsSectionPanel manifest={phoneEntry.manifest} />
                )}
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
                {entries.map((entry, index) => {
                  const EntryIcon = entry.kind === "core" ? entry.section.icon : PuzzlePiece;
                  return (
                    // oxlint-disable-next-line react/forbid-elements -- full-width phone section row (icon, title, chevron); Button has no list-row form
                    <button
                      key={entryKey(entry)}
                      type="button"
                      onClick={() => setPhoneSectionIndex(index)}
                      className={cn(
                        "flex items-center gap-3 border-b border-border/50 px-5 py-3.5 text-left transition-colors active:bg-fill",
                        isFirstPluginEntry(index) && "mt-2 border-t border-border/50",
                      )}
                    >
                      <EntryIcon size={18} weight="regular" aria-hidden="true" className="shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">{entryLabel(entry)}</span>
                      <CaretRight size={14} weight="regular" aria-hidden="true" className="shrink-0 text-fg-subtle" />
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

  const activeEntry = entries[safeActiveIndex];

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

          {entries.map((entry, index) => {
            const active = index === safeActiveIndex;
            const EntryIcon = entry.kind === "core" ? entry.section.icon : PuzzlePiece;
            return (
              <div key={entryKey(entry)} className="contents">
                {isFirstPluginEntry(index) && (
                  <div aria-hidden="true" className="mx-3 my-1.5 h-px shrink-0 bg-border/70" />
                )}
                {/* oxlint-disable-next-line react/forbid-elements -- section nav rail item with roving focus refs and aria-current */}
                <button
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
                  <EntryIcon size={16} weight={active ? "fill" : "regular"} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entryLabel(entry)}</span>
                </button>
              </div>
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
              key={entryKey(activeEntry)}
              className={direction === "forward" ? "ra-motion-tab-panel-in-forward" : "ra-motion-tab-panel-in-backward"}
            >
              {activeEntry.kind === "core" ? (
                <activeEntry.section.Panel />
              ) : (
                <PluginSettingsSectionPanel manifest={activeEntry.manifest} />
              )}
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
