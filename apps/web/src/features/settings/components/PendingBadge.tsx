import { Badge } from "@read-aware/ui";

type PendingBadgeProps = {
  /** Short status, e.g. "Coming soon" or "Desktop". */
  children?: string;
};

/** A quiet status chip for settings that are persisted but not yet wired up. */
export function PendingBadge({ children = "Coming soon" }: PendingBadgeProps) {
  return <Badge variant="muted">{children}</Badge>;
}
