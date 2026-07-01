import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { formatPercent, useTranslation } from "../../../i18n";

type DeltaBadgeProps = {
  /** Fractional change (0.35 = +35%); null renders nothing. */
  value: number | null;
  className?: string;
};

/** Period-over-period change as a quiet ▲/▼ percentage. Monochrome by design. */
export function DeltaBadge({ value, className }: DeltaBadgeProps) {
  const { t } = useTranslation("stats");
  if (value === null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  if (pct === 0) return null;

  const up = pct > 0;
  const Icon = up ? CaretUp : CaretDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        up ? "text-fg" : "text-fg-subtle",
        className,
      )}
      title={t("delta.vsPrevious")}
    >
      <Icon size={11} weight="bold" aria-hidden="true" />
      {formatPercent(Math.abs(pct))}
    </span>
  );
}
