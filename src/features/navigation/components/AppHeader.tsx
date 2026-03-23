import { GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { IconButton, NavItem, Tooltip } from "../../../components";
import { cn } from "../../../components/lib/cn";
import { topNavs, type TopNav } from "../../../state/ui";
import { useTopNavIndicator } from "../hooks/useTopNavIndicator";

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

export function AppHeader({
  activeTopNav,
  isImporting,
  onImport,
  onOpenSettings,
  onOpenSearch,
  onTopNavChange,
}: AppHeaderProps) {
  const { indicator, navListRef, navButtonRefs } = useTopNavIndicator(activeTopNav);

  return (
    <div className="shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]">
      <div className="flex items-center justify-center py-1 text-[10px] font-medium tracking-eyebrow text-stone-400">
        ReadAware
      </div>
      <header className="pt-3 pb-3 sm:pt-4 sm:pb-4">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-screen-2xl items-center gap-6 px-6 sm:gap-8"
        >
          <div ref={navListRef} className="relative flex items-center gap-6 sm:gap-8">
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -bottom-[calc(theme(spacing.4)+1px)] left-0 h-0.5 bg-stone-950 transition-[transform,width,opacity] duration-250 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
                !indicator.ready && "opacity-0",
              )}
              style={{
                width: indicator.width,
                transform: `translateX(${indicator.x}px)`,
              }}
            />
            {topNavs.map((item, index) => (
              <NavItem
                key={item}
                ref={(element) => {
                  navButtonRefs.current[index] = element;
                }}
                active={item === activeTopNav}
                onClick={() => {
                  onTopNavChange(item);
                }}
              >
                {item}
              </NavItem>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-4">
            <Tooltip content="Search">
              <IconButton
                label="Search"
                size="sm"
                onClick={onOpenSearch}
                className={headerIconButtonClass}
                icon={<MagnifyingGlass size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            <Tooltip content={isImporting ? "Importing..." : "Import"}>
              <IconButton
                label="Import"
                size="sm"
                onClick={onImport}
                disabled={isImporting}
                className={headerIconButtonClass}
                icon={<Plus size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            <Tooltip content="Settings">
              <IconButton
                label="Settings"
                size="sm"
                onClick={onOpenSettings}
                className={headerIconButtonClass}
                icon={<GearSix size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
          </div>
        </nav>
      </header>
    </div>
  );
}
