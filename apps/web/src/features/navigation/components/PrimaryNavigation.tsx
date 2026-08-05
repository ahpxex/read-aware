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

  const itemClass = cn("-mb-0 h-12 px-1 pb-0", compact && "text-xs");

  return (
    <nav
      aria-label={t("header.primaryNavigation")}
      className={cn("flex h-12 shrink-0 items-center", compact ? "gap-2" : "gap-3")}
    >
      <NavItem
        active={activeSurface === "shelf"}
        onClick={() => onNavigate("shelf")}
        className={itemClass}
      >
        {t("header.library")}
      </NavItem>
      <span
        aria-hidden="true"
        className={cn(
          "select-none font-sans text-fg-subtle/50",
          compact ? "text-xs" : "text-sm",
        )}
      >
        /
      </span>
      <NavItem
        active={activeSurface === "context"}
        onClick={() => onNavigate("context")}
        className={itemClass}
      >
        {t("header.agent")}
      </NavItem>
    </nav>
  );
}
