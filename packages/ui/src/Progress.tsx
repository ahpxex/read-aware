import { cn } from "./lib/cn";

const sizeClasses = {
  sm: "h-1",
  md: "h-2",
  lg: "h-3",
} as const;

type ProgressProps = {
  value: number;
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
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <span className="font-sans text-[13px] font-medium text-fg-muted">
              {label}
            </span>
          )}
          {showValue && (
            <span className="font-sans text-caption text-fg-muted">
              {Math.round(percent)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "Progress"}
        className={cn("w-full overflow-hidden rounded-full bg-fill-strong", sizeClasses[size])}
      >
        <div
          className="h-full rounded-full bg-fg transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
