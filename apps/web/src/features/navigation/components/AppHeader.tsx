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
};

const headerIconButtonClass =
  "relative text-stone-500 hover:text-stone-950 before:absolute before:-inset-1 before:content-['']";

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
          <Tooltip content="Context" side="bottom">
            <IconButton
              label="Context"
              size="sm"
              aria-pressed={contextActive}
              onClick={() => onTopNavChange(contextActive ? "shelf" : "context")}
              className={cn(
                "relative before:absolute before:-inset-1 before:content-['']",
                contextActive ? "text-stone-950" : "text-stone-500 hover:text-stone-950",
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
