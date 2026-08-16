import { useTranslation } from "react-i18next";
import { cn } from "./lib/cn";

type ProgressRingProps = {
  /**
   * Completion fraction in [0, 1] — or `null` for indeterminate work, which
   * renders a spinning arc (the ring-shaped sibling of `Spinner`). One
   * component for both states so a surface can move between "working, size
   * unknown" and "working, n of m" without swapping elements.
   */
  value: number | null;
  /** Outer diameter in px. Defaults to 16 — the inline-icon size. */
  size?: number;
  className?: string;
  /** Accessible name; falls back to a localized "Loading…". */
  label?: string;
};

export function ProgressRing({ value, size = 16, className, label }: ProgressRingProps) {
  const { t } = useTranslation("ui");
  const strokeWidth = Math.max(1.5, size / 8);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? null : Math.min(1, Math.max(0, value));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", clamped === null && "animate-spin", className)}
      role={clamped === null ? "status" : "progressbar"}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
      aria-valuemin={clamped === null ? undefined : 0}
      aria-valuemax={clamped === null ? undefined : 100}
      aria-label={label ?? t("loading")}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-stone-400/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (clamped ?? 0.25))}
        // Grow clockwise from 12 o'clock; fraction changes glide instead of snapping.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}
