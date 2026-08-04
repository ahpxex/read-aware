import { NavItem } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

type PrimarySurface = "shelf" | "context";

export function PrimaryNavigation({
  activeSurface,
  compact = false,
  onNavigate,
}: {
  activeSurface: PrimarySurface;
  compact?: boolean;
  onNavigate: (surface: PrimarySurface) => void;
}) {
  const { t } = useTranslation("nav");

  const itemClass = (active: boolean) =>
    cn(
      "relative -mb-0 h-12 px-1 pb-0 after:pointer-events-none after:absolute after:-bottom-px after:left-0 after:h-0.5 after:w-full after:origin-center after:bg-fg after:content-['']",
      active ? "after:scale-x-100" : "after:scale-x-0",
      compact && "text-xs",
    );

  return (
    <nav
      aria-label={t("header.primaryNavigation")}
      className={cn("flex h-12 shrink-0 items-center", compact ? "gap-3" : "gap-6")}
    >
      <NavItem
        active={activeSurface === "shelf"}
        onClick={() => onNavigate("shelf")}
        className={itemClass(activeSurface === "shelf")}
      >
        {t("header.library")}
      </NavItem>
      <NavItem
        active={activeSurface === "context"}
        onClick={() => onNavigate("context")}
        className={itemClass(activeSurface === "context")}
      >
        {t("header.agent")}
      </NavItem>
    </nav>
  );
}
