import { Fragment } from "react";
import { NavItem } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";
import type { PrimaryDestination } from "../hooks/usePrimaryDestinations";

export function PrimaryNavigation({
  destinations,
  activeTopNav,
  compact = false,
  onNavigate,
}: {
  destinations: PrimaryDestination[];
  activeTopNav: TopNav;
  compact?: boolean;
  onNavigate: (topNav: TopNav) => void;
}) {
  const { t } = useTranslation("nav");

  const itemClass = cn("-mb-0 h-12 px-1 pb-0", compact && "text-xs");

  return (
    <nav
      aria-label={t("header.primaryNavigation")}
      // w-max: inside the header's scrollable center track the nav must keep
      // its natural width — otherwise labels wrap instead of scrolling.
      className={cn("flex h-12 w-max shrink-0 items-center", compact ? "gap-2" : "gap-3")}
    >
      {destinations.map((destination, index) => (
        <Fragment key={destination.id}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "select-none font-sans text-fg-subtle/50",
                compact ? "text-xs" : "text-sm",
              )}
            >
              /
            </span>
          )}
          <NavItem
            active={activeTopNav === destination.topNav}
            onClick={() => onNavigate(destination.topNav)}
            className={itemClass}
          >
            {destination.label}
          </NavItem>
        </Fragment>
      ))}
    </nav>
  );
}
