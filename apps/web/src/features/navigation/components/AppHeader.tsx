import { type ReactNode } from "react";
import { useAtom } from "jotai";
import {
  CaretLeft,
  ChartLineUp,
  DotsThreeVertical,
  GearSix,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { DropdownMenu, IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import { desktopChromeKind } from "../../../platform/environment";
import { activeCollectionAtom, type TopNav } from "../../../state/ui";
import {
  MenuOverflow,
  type MenuOverflowEntry,
} from "../../menus/components/MenuOverflow";
import { coreMenuMeta } from "../../menus/lib/menu-registry";
import {
  CORE_MENU_DEFAULTS,
  menuConfigAtom,
  pluginMenuId,
  resolveSurfaceLayout,
} from "../../menus/state/menu-config";
import { PluginHeaderItem } from "../../plugins/components/PluginHeaderCluster";
import { openHeaderActionDialog } from "../../plugins/lib/open-header-action";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { headerActionsAtom } from "../../plugins/state/plugin-store";
import { usePrimaryDestinations } from "../hooks/usePrimaryDestinations";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { WindowCaptionControls } from "./WindowCaptionControls";

type AppHeaderProps = {
  activeTopNav: TopNav;
  isImporting: boolean;
  onImport: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onTopNavChange: (topNav: TopNav) => void;
  /** Quiet status/action rendered beside the native window controls. */
  leadingStatus?: ReactNode;
  /** Optional context-specific control (e.g. the shelf view menu) shown in the cluster. */
  viewControl?: ReactNode;
  /** When set, replaces the customizable right-hand utility cluster. The
   *  Agent page uses this for conversation actions. On phones these actions
   *  render before the overflow menu. */
  actions?: ReactNode;
};

const headerIconButtonClass =
  "relative text-fg-muted hover:text-fg before:absolute before:-inset-1 before:content-['']";

/**
 * A single, draggable top bar. The center holds the user-arranged primary
 * destinations (Settings → Customize, `primaryNav` surface — Library and
 * Agent by default); contextual and utility actions stay at the edges
 * instead of competing with that navigation.
 *
 * Phone widths retain the compact primary navigation and search, while the
 * rest of the utility cluster moves into one overflow menu.
 */
export function AppHeader({
  activeTopNav,
  isImporting,
  onImport,
  onOpenSettings,
  onOpenSearch,
  onTopNavChange,
  leadingStatus,
  viewControl,
  actions,
}: AppHeaderProps) {
  const { t } = useTranslation("nav");
  const isPhone = usePhoneViewport();
  // Frameless Windows/Linux: the caption controls own the top-right corner, so
  // the icon cluster moves to the LEFT (the platform-native arrangement).
  // macOS keeps it on the right, mirroring the traffic lights.
  const customChrome = desktopChromeKind() === "custom";
  const statsActive = activeTopNav === "stats";
  const primaryDestinations = usePrimaryDestinations();
  const primaryTopNavs = primaryDestinations.map(
    (destination) => destination.topNav,
  );
  const [activeCollectionId, setActiveCollectionId] =
    useAtom(activeCollectionAtom);
  // Plugin buttons live on the shelf header only (docs/plugin-system.md §5).
  const onShelf = activeTopNav === "shelf";
  const shelfPluginActions = useAtomValue(headerActionsAtom).filter(
    (action) => action.surface === "shelf",
  );

  // User-arranged layout: visible items inline (core + plugin interleaved in
  // the user's order), the rest behind the vertical-dots overflow.
  const { t: tMenus } = useTranslation("settings");
  const menuConfig = useAtomValue(menuConfigAtom);
  const knownShelfIds = onShelf
    ? [
        ...CORE_MENU_DEFAULTS.shelfHeader,
        ...shelfPluginActions.map((a) => pluginMenuId(a.key)),
      ]
    : CORE_MENU_DEFAULTS.shelfHeader;
  const shelfLayout = resolveSurfaceLayout(
    menuConfig.shelfHeader,
    knownShelfIds,
  );

  const coreShelfNodes: Record<string, ReactNode | null> = {
    "core:search": (
      <Tooltip content={t("header.search")} side="bottom">
        <IconButton
          label={t("header.search")}
          size="sm"
          onClick={onOpenSearch}
          className={headerIconButtonClass}
          icon={
            <MagnifyingGlass size={16} weight="regular" aria-hidden="true" />
          }
        />
      </Tooltip>
    ),
    "core:import": (
      <Tooltip
        content={isImporting ? t("header.importing") : t("header.import")}
        side="bottom"
      >
        <IconButton
          label={t("header.import")}
          size="sm"
          onClick={onImport}
          disabled={isImporting}
          className={headerIconButtonClass}
          icon={<Plus size={16} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:viewControl": viewControl ?? null,
    "core:stats": (
      <Tooltip content={t("header.stats")} side="bottom">
        <IconButton
          label={t("header.stats")}
          size="sm"
          aria-pressed={statsActive}
          onClick={() => onTopNavChange(statsActive ? "shelf" : "stats")}
          className={cn(
            "relative before:absolute before:-inset-1 before:content-['']",
            statsActive ? "text-fg" : "text-fg-muted hover:text-fg",
          )}
          icon={
            <ChartLineUp
              size={16}
              weight={statsActive ? "fill" : "regular"}
              aria-hidden="true"
            />
          }
        />
      </Tooltip>
    ),
    "core:settings": (
      <Tooltip content={t("header.settings")} side="bottom" align="end">
        <IconButton
          label={t("header.settings")}
          size="sm"
          onClick={onOpenSettings}
          className={headerIconButtonClass}
          icon={<GearSix size={16} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
  };

  const coreShelfRun: Record<string, () => void> = {
    "core:search": onOpenSearch,
    "core:import": onImport,
    "core:stats": () => onTopNavChange(statsActive ? "shelf" : "stats"),
    "core:settings": onOpenSettings,
  };
  const shelfOverflowEntries = shelfLayout.overflow
    .map((id): MenuOverflowEntry | null => {
      if (id.startsWith("plugin:")) {
        const action = shelfPluginActions.find(
          (entry) => pluginMenuId(entry.key) === id,
        );
        if (!action) return null;
        return {
          id,
          label: contributionText(action.title),
          icon: renderPluginIcon(action.icon, 16),
          run: () => {
            if (action.presentation === "page")
              onTopNavChange(`plugin:${action.key}`);
            else void openHeaderActionDialog(action, {});
          },
        };
      }
      const meta = coreMenuMeta("shelfHeader", id);
      if (!meta) return null;
      if (id === "core:viewControl") {
        if (!viewControl) return null;
        return {
          id,
          label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
          icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
          node: viewControl,
        };
      }
      const run = coreShelfRun[id];
      if (!run) return null;
      return {
        id,
        label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
        icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
        run,
      };
    })
    .filter((entry): entry is MenuOverflowEntry => entry !== null);

  // An open collection reads as a pushed view. So does any surface the center
  // navigation cannot round-trip: the back button appears unless BOTH the
  // current surface and Library are visible primary destinations — the user
  // must never be stranded off the shelf.
  const inCollection = activeTopNav === "shelf" && activeCollectionId !== null;
  const showBack =
    inCollection ||
    (activeTopNav !== "shelf" &&
      !(
        primaryTopNavs.includes(activeTopNav) &&
        primaryTopNavs.includes("shelf")
      ));
  const backLabel = inCollection
    ? t("header.back.allBooks")
    : t("header.back.toShelf");
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
          className="relative flex h-12 items-center gap-1.5"
          style={{
            paddingLeft: "max(0.75rem, var(--ra-safe-left))",
            // A narrow desktop window uses this layout too — keep clear of the
            // self-drawn caption controls on frameless platforms.
            paddingRight:
              "calc(max(0.75rem, var(--ra-safe-right)) + var(--ra-window-controls-inset))",
          }}
        >
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
          {primaryDestinations.length > 0 && (
            <div className="absolute left-1/2 top-0 -translate-x-1/2">
              <PrimaryNavigation
                compact
                destinations={primaryDestinations}
                activeTopNav={activeTopNav}
                onNavigate={onTopNavChange}
              />
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <IconButton
              label={t("header.search")}
              size="sm"
              onClick={onOpenSearch}
              className={cn(headerIconButtonClass, "shrink-0")}
              icon={
                <MagnifyingGlass
                  size={18}
                  weight="regular"
                  aria-hidden="true"
                />
              }
            />
            {actions}
            <DropdownMenu
              align="right"
              className="shrink-0"
              trigger={
                <span className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted">
                  <DotsThreeVertical
                    size={18}
                    weight="bold"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t("header.more")}</span>
                </span>
              }
              items={[
                {
                  label: isImporting
                    ? t("header.importing")
                    : t("header.import"),
                  icon: <Plus size={16} weight="regular" aria-hidden="true" />,
                  onClick: onImport,
                  disabled: isImporting,
                },
                {
                  label: t("header.stats"),
                  icon: (
                    <ChartLineUp
                      size={16}
                      weight={statsActive ? "fill" : "regular"}
                      aria-hidden="true"
                    />
                  ),
                  onClick: () => onTopNavChange("stats"),
                },
                {
                  label: t("header.settings"),
                  icon: (
                    <GearSix size={16} weight="regular" aria-hidden="true" />
                  ),
                  onClick: onOpenSettings,
                },
                // Plugin actions collapse into the phone overflow menu; popups
                // open in the Dialog host (no anchor to speak of on phones).
                ...(onShelf
                  ? shelfPluginActions.map((action) => ({
                      label: contributionText(action.title),
                      icon: renderPluginIcon(action.icon, 16),
                      onClick: () => {
                        if (action.presentation === "page") {
                          onTopNavChange(`plugin:${action.key}`);
                        } else {
                          void openHeaderActionDialog(action, {});
                        }
                      },
                    }))
                  : []),
              ]}
            />
          </div>
        </div>
        <WindowCaptionControls />
      </header>
    );
  }

  return (
    <header
      className="relative shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]"
      style={{ paddingTop: "var(--ra-safe-top)" }}
    >
      <div
        data-tauri-drag-region=""
        className="relative flex h-12 items-center"
        style={{
          // Clear the macOS traffic lights whenever left-side content is present.
          paddingLeft:
            showBack || leadingStatus
              ? "max(1.25rem, var(--ra-traffic-light-inset))"
              : "1.25rem",
          // Clear the self-drawn caption controls on frameless platforms.
          paddingRight: "calc(1.25rem + var(--ra-window-controls-inset))",
        }}
      >
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
        {primaryDestinations.length > 0 && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <PrimaryNavigation
              destinations={primaryDestinations}
              activeTopNav={activeTopNav}
              onNavigate={onTopNavChange}
            />
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5",
            !customChrome && "ml-auto",
          )}
        >
          {actions ?? (
            <>
              {shelfLayout.visible.map((id) => {
                if (id.startsWith("plugin:")) {
                  const action = shelfPluginActions.find(
                    (entry) => pluginMenuId(entry.key) === id,
                  );
                  return action ? (
                    <PluginHeaderItem
                      key={id}
                      action={action}
                      onOpenPage={(key) => onTopNavChange(`plugin:${key}`)}
                    />
                  ) : null;
                }
                const node = coreShelfNodes[id];
                return node ? (
                  <span key={id} className="contents">
                    {node}
                  </span>
                ) : null;
              })}
              <MenuOverflow entries={shelfOverflowEntries} />
            </>
          )}
        </div>
      </div>
      <WindowCaptionControls />
    </header>
  );
}
