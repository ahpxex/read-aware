import { type ReactNode } from "react";
import { Cards, GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
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

  return (
    <header className="shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]">
      <div
        data-tauri-drag-region=""
        className="flex h-12 items-center px-5"
      >
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
