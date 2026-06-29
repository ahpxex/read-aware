import { type ReactNode } from "react";
import { Cards, CaretLeft, ChartLineUp, GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { TopNav } from "../../../state/ui";

type AppHeaderProps = {
  activeTopNav: TopNav;
  isImporting: boolean;
  onImport: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onTopNavChange: (topNav: TopNav) => void;
  /** Optional context-specific control (e.g. the shelf view menu) shown in the cluster. */
  viewControl?: ReactNode;
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
}: AppHeaderProps) {
  const contextActive = activeTopNav === "context";
  const statsActive = activeTopNav === "stats";
  // The secondary surfaces (Context, Stats) read as standalone pages, so give
  // them a back affordance on the left — mirroring the reader's top bar.
  const showBack = activeTopNav !== "shelf";

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
          <Tooltip content="Back to shelf" side="bottom">
            <IconButton
              label="Back to shelf"
              size="sm"
              onClick={() => onTopNavChange("shelf")}
              className={headerIconButtonClass}
              icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
            />
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip content="Search" side="bottom">
            <IconButton
              label="Search"
              size="sm"
              onClick={onOpenSearch}
              className={headerIconButtonClass}
              icon={<MagnifyingGlass size={16} weight="regular" aria-hidden="true" />}
            />
          </Tooltip>
          <Tooltip content={isImporting ? "Importing..." : "Import"} side="bottom">
            <IconButton
              label="Import"
              size="sm"
              onClick={onImport}
              disabled={isImporting}
              className={headerIconButtonClass}
              icon={<Plus size={16} weight="regular" aria-hidden="true" />}
            />
          </Tooltip>
          {viewControl}
          <Tooltip content="Context" side="bottom">
            <IconButton
              label="Context"
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
          <Tooltip content="Reading stats" side="bottom">
            <IconButton
              label="Reading stats"
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
          <Tooltip content="Settings" side="bottom">
            <IconButton
              label="Settings"
              size="sm"
              onClick={onOpenSettings}
              className={headerIconButtonClass}
              icon={<GearSix size={16} weight="regular" aria-hidden="true" />}
            />
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
