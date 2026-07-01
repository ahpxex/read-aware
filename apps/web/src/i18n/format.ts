/**
 * Locale-aware formatting layer.
 *
 * Everything that turns a number/date/duration into display text goes through
 * here so it follows the *app* language (not the OS locale, which is what a bare
 * `toLocaleString()` / `new Intl.*(undefined)` would use). All formatters read
 * the active locale from the i18next instance, so call sites stay parameterless
 * — but a component that renders formatted values with no `t()` nearby should
 * still call `useTranslation()` (or `useLocale()`) so it re-renders on a
 * language switch.
 */
import { i18n } from "./instance";
import { DEFAULT_LOCALE, type AppLocale } from "./config";

/** The language i18next is currently rendering in. */
export function currentLocale(): AppLocale {
  return (i18n.language as AppLocale) || DEFAULT_LOCALE;
}

function toDate(value: number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Format an absolute timestamp/date. Defaults to a `Jan 5, 2026`-style date. */
export function formatDate(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(currentLocale(), options).format(toDate(value));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale(), options).format(value);
}

/** Format a `0`–`100` value as a locale-correct percentage (`42%` / `42 %`). */
export function formatPercent(value0to100: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(currentLocale(), {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value0to100 / 100);
}

function unit(value: number, name: "hour" | "minute"): string {
  return new Intl.NumberFormat(currentLocale(), {
    style: "unit",
    unit: name,
    unitDisplay: "narrow",
  }).format(value);
}

/** Compact, locale-aware reading duration: `<1m` → `42m` → `3h` → `3h 20m`. */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return unit(0, "minute");
  if (ms < 60_000) return `<${unit(1, "minute")}`;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return unit(minutes, "minute");
  if (minutes === 0) return unit(hours, "hour");
  return `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
}

/** Relative day label (`today`, `yesterday`, `3 days ago`, `in 2 days`). */
export function formatRelativeDays(days: number): string {
  return new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" }).format(days, "day");
}

/**
 * Localized weekday names indexed by `Date.getDay()` (0 = Sunday … 6 = Saturday).
 * Anchored to a known week in UTC so the labels are deterministic.
 */
export function getWeekdayNames(style: "long" | "short" | "narrow" = "short"): string[] {
  const fmt = new Intl.DateTimeFormat(currentLocale(), { weekday: style, timeZone: "UTC" });
  // 2023-01-01 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))));
}

/** Localized month names indexed 0 = January … 11 = December. */
export function getMonthNames(style: "long" | "short" | "narrow" = "short"): string[] {
  const fmt = new Intl.DateTimeFormat(currentLocale(), { month: style, timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2023, i, 15))));
}

/** Format an hour-of-day (0–23) as a locale-correct clock label (`3 PM` / `15`). */
export function formatHour(hour: number): string {
  const fmt = new Intl.DateTimeFormat(currentLocale(), { hour: "numeric", timeZone: "UTC" });
  return fmt.format(new Date(Date.UTC(2023, 0, 1, hour)));
}
