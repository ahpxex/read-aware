import type { PluginListItem } from "./plugin-types";

export type PluginTimelineRange = "today" | "week" | "month" | "all";

export type PluginTimelineSection = {
  key: string;
  label: string;
  items: PluginListItem[];
};

type TimelineLabels = {
  today: string;
  yesterday: string;
  unknownDate: string;
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function timestampOf(item: PluginListItem): number | null {
  if (!item.timestamp) return null;
  const timestamp = Date.parse(item.timestamp);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function boundsForRange(range: PluginTimelineRange, now: Date): [number, number] | null {
  if (range === "all") return null;

  const today = startOfDay(now);
  if (range === "today") return [today.getTime(), addDays(today, 1).getTime()];

  if (range === "week") {
    const isoDay = (today.getDay() + 6) % 7;
    const start = addDays(today, -isoDay);
    return [start.getTime(), addDays(start, 7).getTime()];
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return [start.getTime(), end.getTime()];
}

/** Filter a timeline by local calendar boundaries, then sort newest first. */
export function filterPluginTimelineItems(
  items: PluginListItem[],
  range: PluginTimelineRange,
  now = new Date(),
): PluginListItem[] {
  const bounds = boundsForRange(range, now);
  return items
    .filter((item) => {
      if (!bounds) return true;
      const timestamp = timestampOf(item);
      return timestamp != null && timestamp >= bounds[0] && timestamp < bounds[1];
    })
    .sort((left, right) => (timestampOf(right) ?? -Infinity) - (timestampOf(left) ?? -Infinity));
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

/** Group already-filtered items into host-labelled local calendar days. */
export function groupPluginTimelineItems(
  items: PluginListItem[],
  locale: string,
  labels: TimelineLabels,
  now = new Date(),
): PluginTimelineSection[] {
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const currentYearFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const otherYearFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const sections = new Map<string, PluginTimelineSection>();

  for (const item of items) {
    const timestamp = timestampOf(item);
    let key = "unknown";
    let label = labels.unknownDate;
    if (timestamp != null) {
      const date = new Date(timestamp);
      key = localDateKey(date);
      if (key === localDateKey(today)) label = labels.today;
      else if (key === localDateKey(yesterday)) label = labels.yesterday;
      else {
        label = (date.getFullYear() === today.getFullYear()
          ? currentYearFormatter
          : otherYearFormatter).format(date);
      }
    }

    const section = sections.get(key);
    if (section) section.items.push(item);
    else sections.set(key, { key, label, items: [item] });
  }

  return [...sections.values()];
}
