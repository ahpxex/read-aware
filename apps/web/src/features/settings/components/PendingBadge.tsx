import { Badge } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

type PendingBadgeProps = {
  /** Short status, e.g. "Coming soon" or "Desktop". Defaults to "Coming soon". */
  children?: string;
};

/** A quiet status chip for settings that are persisted but not yet wired up. */
export function PendingBadge({ children }: PendingBadgeProps) {
  const { t } = useTranslation("settings");
  return <Badge variant="muted">{children ?? t("pendingBadge.comingSoon")}</Badge>;
}
