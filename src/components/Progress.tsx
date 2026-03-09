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
            <span className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-600">
              {label}
            </span>
          )}
          {showValue && (
            <span className="font-sans text-caption text-stone-600">
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
        aria-label={label}
        className={cn("w-full overflow-hidden rounded-full bg-stone-200", sizeClasses[size])}
      >
        <div
          className="h-full rounded-full bg-stone-950 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
