import { useTranslation } from "react-i18next";
import { cn } from "./lib/cn";

type SkeletonProps = {
  variant?: "text" | "circular" | "rectangular";
  width?: string;
  height?: string;
  lines?: number;
  className?: string;
};

export function Skeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  className,
}: SkeletonProps) {
  const { t } = useTranslation("ui");
  if (variant === "text" && lines > 1) {
    return (
      <div role="status" aria-label={t("loading")} className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-4 animate-pulse rounded bg-fill-strong",
              i === lines - 1 && "w-3/4",
            )}
            style={{ width: i < lines - 1 ? width : undefined }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label={t("loading")}
      className={cn(
        "animate-pulse bg-fill-strong",
        variant === "text" && "h-4 rounded",
        variant === "circular" && "rounded-full",
        variant === "rectangular" && "rounded",
        className,
      )}
      style={{ width, height }}
    />
  );
}
