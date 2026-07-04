import { type ReactNode } from "react";
import { useAtom } from "jotai";
import { Cards, CaretLeft, ChartLineUp, GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { activeCollectionAtom, type TopNav } from "../../../state/ui";

type AppHeaderProps = {
  activeTopNav: TopNav;
  isImporting: boolean;
  onImport: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onTopNavChange: (topNav: TopNav) => void;
  /** Optional context-specific control (e.g. the shelf view menu) shown in the cluster. */
  viewControl?: ReactNode;
  /** When set, replaces the default right-hand icon cluster entirely — the
   *  Context page uses this to show only its annotations popover. */
  actions?: ReactNode;
};

const headerIconButtonClass =
  "relative text-fg-muted hover:text-fg before:absolute before:-inset-1 before:content-['']";

/**
 * A single, draggable top bar — no separate title band, no tab switcher, no
 * wordmark: just the native traffic lights on the left (the bar is the window
 * drag region) and a right cluster of icon actions.
 */
export function AppHeader({
  activeTopNav,
  isImporting,
  onImport,
  onOpenSettings,
  onOpenSearch,
  onTopNavChange,
  viewControl,
  actions,
}: AppHeaderProps) {
  const { t } = useTranslation("nav");
  const contextActive = activeTopNav === "context";
  const statsActive = activeTopNav === "stats";
  const [activeCollectionId, setActiveCollectionId] = useAtom(activeCollectionAtom);

  // Standalone surfaces (Context, Stats) and an open collection all read as
  // pushed views, so give them a back affordance on the left — mirroring the
  // reader's top bar. Inside a collection, back returns to the full shelf.
  const inCollection = activeTopNav === "shelf" && activeCollectionId !== null;
  const showBack = activeTopNav !== "shelf" || inCollection;
  const backLabel = inCollection ? t("header.back.allBooks") : t("header.back.toShelf");
  const handleBack = () => {
    if (inCollection) setActiveCollectionId(null);
    else onTopNavChange("shelf");
  };

  return (
    <header className="shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]">
      <div
        data-tauri-drag-region=""
        className="flex h-12 items-center pr-5"
        style={{
          // Clear the macOS traffic lights only when the left cluster is present.
          paddingLeft: showBack ? "max(1.25rem, var(--ra-traffic-light-inset))" : "1.25rem",
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
        <div className="ml-auto flex items-center gap-1.5">
          {actions ?? (
            <>
              <Tooltip content={t("header.search")} side="bottom">
                <IconButton
                  label={t("header.search")}
                  size="sm"
                  onClick={onOpenSearch}
                  className={headerIconButtonClass}
                  icon={<MagnifyingGlass size={16} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content={isImporting ? t("header.importing") : t("header.import")} side="bottom">
                <IconButton
                  label={t("header.import")}
                  size="sm"
                  onClick={onImport}
                  disabled={isImporting}
                  className={headerIconButtonClass}
                  icon={<Plus size={16} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              {viewControl}
              <Tooltip content={t("header.context")} side="bottom">
                <IconButton
                  label={t("header.context")}
                  size="sm"
                  aria-pressed={contextActive}
                  onClick={() => onTopNavChange(contextActive ? "shelf" : "context")}
                  className={cn(
                    "relative before:absolute before:-inset-1 before:content-['']",
                    contextActive ? "text-fg" : "text-fg-muted hover:text-fg",
                  )}
                  icon={<Cards size={16} weight={contextActive ? "fill" : "regular"} aria-hidden="true" />}
                />
              </Tooltip>
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
                  icon={<ChartLineUp size={16} weight={statsActive ? "fill" : "regular"} aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content={t("header.settings")} side="bottom" align="end">
                <IconButton
                  label={t("header.settings")}
                  size="sm"
                  onClick={onOpenSettings}
                  className={headerIconButtonClass}
                  icon={<GearSix size={16} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
