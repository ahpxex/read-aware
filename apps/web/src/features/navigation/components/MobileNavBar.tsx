import { Books, Cards, ChartLineUp, GearSix } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";

type MobileNavBarProps = {
  activeTopNav: TopNav;
  onTopNavChange: (topNav: TopNav) => void;
  onOpenSettings: () => void;
};

type TabItem = {
  key: "shelf" | "context" | "stats" | "settings";
  icon: typeof Books;
  active: boolean;
  onSelect: () => void;
};

/**
 * Phone-width primary navigation: a thumb-reachable bottom tab bar for the
 * three top-level surfaces plus Settings. Rendered only on phone viewports
 * (see App.tsx); on wider screens the AppHeader icon cluster stays the sole
 * navigation. Pads itself below with the home-indicator safe area.
 */
export function MobileNavBar({
  activeTopNav,
  onTopNavChange,
  onOpenSettings,
}: MobileNavBarProps) {
  const { t } = useTranslation("nav");

  const tabs: TabItem[] = [
    {
      key: "shelf",
      icon: Books,
      active: activeTopNav === "shelf",
      onSelect: () => onTopNavChange("shelf"),
    },
    {
      key: "context",
      icon: Cards,
      active: activeTopNav === "context",
      onSelect: () => onTopNavChange("context"),
    },
    {
      key: "stats",
      icon: ChartLineUp,
      active: activeTopNav === "stats",
      onSelect: () => onTopNavChange("stats"),
    },
    { key: "settings", icon: GearSix, active: false, onSelect: onOpenSettings },
  ];

  return (
    <nav className="shrink-0 border-t border-border bg-[var(--ra-main-surface-color)] pb-[var(--ra-safe-bottom)]">
      <div className="flex h-14 items-stretch">
        {tabs.map(({ key, icon: Icon, active, onSelect }) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === "settings" ? undefined : active}
            onClick={onSelect}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5",
              active ? "text-fg" : "text-fg-muted",
            )}
          >
            <Icon size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span className="text-[0.6875rem] leading-none">{t(`tabs.${key}`)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
