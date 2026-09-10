import { useTranslation } from "react-i18next";
import { cn } from "./lib/cn";

const sizeClasses = {
  sm: "h-1",
  md: "h-2",
  lg: "h-3",
} as const;

type ProgressProps = {
  value: number | null;
  max?: number;
  size?: keyof typeof sizeClasses;
  label?: string;
  showValue?: boolean;
  className?: string;
};

export function Progress({
  value,
  max = 100,
  size = "md",
  label,
  showValue = false,
  className,
}: ProgressProps) {
  const { t } = useTranslation("ui");
  const maximum = Number.isFinite(max) && max > 0 ? max : 100;
  const current = value === null ? undefined : Math.min(maximum, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = current === undefined ? undefined : current / maximum * 100;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || showValue) && (
        <div className="flex min-w-0 items-center justify-between gap-2">
          {label && (
            <span className="min-w-0 break-words font-sans text-[13px] font-medium text-fg-muted">
              {label}
            </span>
          )}
          {showValue && (
            <span className="min-w-10 shrink-0 text-end font-sans text-caption text-fg-muted">
              {percent === undefined ? null : `${Math.round(percent)}%`}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={current === undefined ? undefined : 0}
        aria-valuemax={current === undefined ? undefined : maximum}
        aria-busy={current === undefined || undefined}
        aria-label={label ?? t("progress")}
        className={cn("w-full overflow-hidden rounded-full bg-fill-strong", sizeClasses[size])}
      >
        <div
          className={cn("h-full rounded-full bg-fg transition-[width] duration-300", current === undefined && "animate-pulse motion-reduce:animate-none")}
          style={{ width: current === undefined ? "33%" : `${percent}%` }}
        />
      </div>
    </div>
  );
}
