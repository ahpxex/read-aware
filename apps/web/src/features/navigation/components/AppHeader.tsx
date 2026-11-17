import { type ReactNode } from "react";
import { useAtom } from "jotai";
import { CaretLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useTranslation } from "../../../i18n";
import { desktopChromeKind, type DesktopChromeKind } from "../../../platform/environment";
import { activeCollectionAtom, type TopNav } from "../../../state/ui";
import { MenuOverflow, type MenuOverflowEntry } from "../../menus";
import { useHeaderClusterCapacity } from "../hooks/useHeaderClusterCapacity";
import { usePrimaryDestinations } from "../hooks/usePrimaryDestinations";
import { headerIconButtonClass, useShelfHeaderEntries } from "../hooks/useShelfHeaderEntries";
import type { HeaderActionEntry } from "../lib/header-actions";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { WindowCaptionControls } from "./WindowCaptionControls";

type AppHeaderProps = {
  activeTopNav: TopNav;
  isImporting: boolean;
  onImport: () => void;
  /** Import every book below a picked folder. */
  onImportFolder: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onTopNavChange: (topNav: TopNav) => void;
  /** Quiet status/action rendered beside the native window controls. */
  leadingStatus?: ReactNode;
  /** Optional context-specific control (e.g. the shelf view menu) shown in the cluster. */
  viewControl?: ReactNode;
  /** When set, replaces the customizable right-hand utility cluster. The
   *  Agent page uses this for conversation actions. Atomized so narrow
   *  windows collapse them one by one into the dots menu (never squeezing
   *  the primary navigation); on phones they render before that menu. */
  actions?: HeaderActionEntry[];
  /**
   * Which window chrome the shell draws. Defaults to the running platform's.
   * On frameless Windows/Linux ("custom") the caption controls own the
   * top-right, so the utility cluster moves to the LEFT.
   */
  chrome?: DesktopChromeKind;
};

/**
 * A single, draggable top bar. The center holds the user-arranged primary
 * destinations (Settings → Customize, `primaryNav` surface — Library, Agent
 * and Notes by default); contextual and utility actions — and the pages the
 * navigation does not hold — stay at the edges instead of competing with it.
 *
 * Phone widths retain the compact primary navigation and search, while the
 * rest of the utility cluster moves into one overflow menu.
 */
export function AppHeader({
  activeTopNav,
  isImporting,
  onImport,
  onImportFolder,
  onOpenSettings,
  onOpenSearch,
  onTopNavChange,
  leadingStatus,
  viewControl,
  actions,
  chrome = desktopChromeKind(),
}: AppHeaderProps) {
  const { t } = useTranslation("nav");
  const isPhone = usePhoneViewport();
  // Frameless Windows/Linux: the caption controls own the top-right corner, so
  // the icon cluster moves to the LEFT (the platform-native arrangement).
  // macOS keeps it on the right, mirroring the traffic lights.
  const customChrome = chrome === "custom";
  const primaryDestinations = usePrimaryDestinations();
  const primaryTopNavs = primaryDestinations.map((destination) => destination.topNav);
  const [activeCollectionId, setActiveCollectionId] = useAtom(activeCollectionAtom);
  // The user-arranged shelf header: inline items and the "More" menu's rows,
  // each built once (useShelfHeaderEntries) for whichever place it lands.
  const shelfEntries = useShelfHeaderEntries({
    activeTopNav,
    isImporting,
    onImport,
    onImportFolder,
    onOpenSettings,
    onOpenSearch,
    onTopNavChange,
    viewControl,
  });

  // The primary navigation is canonical: it never yields width. When the
  // window narrows, cluster ICONS collapse into the dots menu instead — the
  // user-arranged shelf items on desktop, contextual actions when a surface
  // supplies them, and (on phones) the inline search icon.
  const actionCount = actions?.length ?? 0;
  // On phones a contextual surface keeps ONE inline action — its primary —
  // no matter how many it supplies or how much width the measurement finds:
  // the centered navigation owns a phone header, and a row of surface icons
  // visibly squeezes it. Everything else stays reachable from the dots menu.
  const phoneActionCap = Math.min(actionCount, 1);
  const { containerRef, fixedLeftRef, navBoxRef, rightSpacerRef, capacity } = useHeaderClusterCapacity(
    isPhone ? 1 + phoneActionCap : actions ? actionCount : shelfEntries.visible.length,
  );
  // Contextual actions collapse from the tail; on phones the search icon
  // folds FIRST (it stays reachable from the dots menu either way).
  const inlineActionCap = isPhone ? Math.min(phoneActionCap, capacity) : Math.min(actionCount, capacity);
  const inlineActionEntries = actions?.slice(0, inlineActionCap) ?? [];
  const collapsedActionEntries = (actions?.slice(inlineActionCap) ?? []).map((entry) => entry.overflow);
  const showSearchInline = capacity >= inlineActionCap + 1;
  const overflowRows = (entries: HeaderActionEntry[]): MenuOverflowEntry[] => entries.map((entry) => entry.overflow);

  // An open collection reads as a pushed view. So does any surface the center
  // navigation cannot round-trip: the back button appears unless BOTH the
  // current surface and Library are visible primary destinations — the user
  // must never be stranded off the shelf.
  const inCollection = activeTopNav === "shelf" && activeCollectionId !== null;
  const showBack =
    inCollection ||
    (activeTopNav !== "shelf" && !(primaryTopNavs.includes(activeTopNav) && primaryTopNavs.includes("shelf")));
  const backLabel = inCollection ? t("header.back.allBooks") : t("header.back.toShelf");
  const handleBack = () => {
    if (inCollection) setActiveCollectionId(null);
    else onTopNavChange("shelf");
  };

  if (isPhone) {
    return (
      <header
        className="relative shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]"
        // Keep the bar clear of the status bar / notch and display cutouts.
        style={{ paddingTop: "var(--ra-safe-top)" }}
      >
        <div
          // Three tracks, equal sides, so the navigation is truly centered yet
          // stays IN FLOW — it can never overlap the edge clusters the way the
          // old absolutely-positioned center could. When everything genuinely
          // cannot fit, the middle track scrolls instead of stacking. Display
          // cutouts and caption controls clear via in-track spacers, keeping
          // the container padding symmetric so the center stays centered.
          ref={containerRef}
          className="grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-3"
        >
          <div className="flex items-center gap-1.5">
            <span ref={fixedLeftRef} className="flex items-center gap-1.5">
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ width: "max(0px, calc(var(--ra-safe-left) - 0.75rem))" }}
              />
              {showBack && (
                <IconButton
                  label={backLabel}
                  size="sm"
                  onClick={handleBack}
                  className={cn(headerIconButtonClass, "shrink-0")}
                  icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
                />
              )}
              {leadingStatus}
            </span>
          </div>
          <div
            ref={navBoxRef}
            className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {primaryDestinations.length > 0 && (
              <PrimaryNavigation
                compact
                destinations={primaryDestinations}
                activeTopNav={activeTopNav}
                onNavigate={onTopNavChange}
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-1.5">
            {/* Search yields to the overflow menu first; contextual actions
                collapse next, from the tail. The navigation never yields. */}
            {showSearchInline && (
              <IconButton
                label={t("header.search")}
                size="sm"
                onClick={onOpenSearch}
                className={cn(headerIconButtonClass, "shrink-0")}
                icon={<MagnifyingGlass size={18} weight="regular" aria-hidden="true" />}
              />
            )}
            {inlineActionEntries.map((entry) => (
              <span key={entry.id} className="contents">
                {entry.inline}
              </span>
            ))}
            <MenuOverflow
              entries={[
                ...(!showSearchInline
                  ? [
                      {
                        id: "core:search",
                        label: t("header.search"),
                        icon: <MagnifyingGlass size={16} weight="regular" aria-hidden="true" />,
                        run: onOpenSearch,
                      },
                    ]
                  : []),
                ...collapsedActionEntries,
                // Every shelf item, in the user's order: the phone header
                // keeps only search inline (above), never the shelf icons.
                ...overflowRows([...shelfEntries.visible, ...shelfEntries.overflow]).filter(
                  (entry) => entry.id !== "core:search",
                ),
              ]}
            />
            <div
              ref={rightSpacerRef}
              aria-hidden="true"
              className="shrink-0"
              // A narrow desktop window uses this layout too — keep clear of
              // display cutouts and self-drawn caption controls.
              style={{
                width: "calc(max(0px, calc(var(--ra-safe-right) - 0.75rem)) + var(--ra-window-controls-inset))",
              }}
            />
          </div>
        </div>
        <WindowCaptionControls chrome={chrome} />
      </header>
    );
  }

  // Visible items past the current capacity collapse into the dots menu,
  // ahead of the items the user parked there deliberately.
  const inlineShelfEntries = shelfEntries.visible.slice(0, capacity);
  const shelfOverflowRows = overflowRows([...shelfEntries.visible.slice(capacity), ...shelfEntries.overflow]);

  // The utility cluster: contextual actions when a surface supplies them,
  // otherwise the user-arranged shelf items — either way with a dots menu
  // holding whatever the current width cannot show.
  const inlineEntries = actions ? inlineActionEntries : inlineShelfEntries;
  const headerCluster = (
    <div className="flex items-center gap-1.5">
      {inlineEntries.map((entry) => (
        <span key={entry.id} className="contents">
          {entry.inline}
        </span>
      ))}
      <MenuOverflow entries={actions ? collapsedActionEntries : shelfOverflowRows} />
    </div>
  );

  return (
    <header
      className="relative shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]"
      style={{ paddingTop: "var(--ra-safe-top)" }}
    >
      <div
        ref={containerRef}
        data-tauri-drag-region=""
        // Same three-track scheme as the phone layout: equal side tracks keep
        // the navigation truly centered while it stays in flow. The
        // navigation is canonical and keeps its natural width; cluster icons
        // collapse into the dots menu when the window narrows (see
        // useHeaderClusterCapacity). Window-chrome clearances (traffic
        // lights, self-drawn caption controls) live as spacers INSIDE the
        // tracks — asymmetric container padding would drag the center track
        // off the window's midline.
        className="grid h-12 grid-cols-[1fr_auto_1fr] items-center px-5"
      >
        <div data-tauri-drag-region="" className="flex items-center">
          <span ref={fixedLeftRef} className="flex items-center">
            <div
              aria-hidden="true"
              className="shrink-0"
              style={{
                // Clear the macOS traffic lights whenever left content renders.
                width: showBack || leadingStatus ? "max(0px, calc(var(--ra-traffic-light-inset) - 1.25rem))" : 0,
              }}
            />
            {showBack && (
              <Tooltip content={backLabel} side="bottom">
                <IconButton
                  label={backLabel}
                  size="sm"
                  onClick={handleBack}
                  className={headerIconButtonClass}
                  icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
            )}
            {leadingStatus}
          </span>
          {/* Frameless Windows/Linux: the cluster lives on the LEFT (see the
              customChrome note above); the caption controls own the right. */}
          {customChrome && headerCluster}
        </div>
        <div
          ref={navBoxRef}
          className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {primaryDestinations.length > 0 && (
            <PrimaryNavigation
              destinations={primaryDestinations}
              activeTopNav={activeTopNav}
              onNavigate={onTopNavChange}
            />
          )}
        </div>
        <div data-tauri-drag-region="" className="flex items-center justify-end">
          {!customChrome && headerCluster}
          <div
            ref={rightSpacerRef}
            aria-hidden="true"
            className="shrink-0"
            // Clear the self-drawn caption controls on frameless platforms.
            style={{ width: "var(--ra-window-controls-inset)" }}
          />
        </div>
      </div>
      <WindowCaptionControls chrome={chrome} />
    </header>
  );
}
