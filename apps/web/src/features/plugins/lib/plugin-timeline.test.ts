import { describe, expect, test } from "bun:test";
import type { PluginListItem } from "./plugin-types";
import {
  filterPluginTimelineItems,
  groupPluginTimelineItems,
} from "./plugin-timeline";

const now = new Date(2026, 6, 24, 12);
const item = (id: string, date: Date | string): PluginListItem => ({
  id,
  title: id,
  timestamp: typeof date === "string" ? date : date.toISOString(),
});
const items = [
  item("month", new Date(2026, 6, 3, 9)),
  item("unknown", "not-a-date"),
  item("today", new Date(2026, 6, 24, 10)),
  item("previous-month", new Date(2026, 5, 30, 18)),
  item("week", new Date(2026, 6, 20, 8)),
  item("yesterday", new Date(2026, 6, 23, 17)),
];

describe("plugin timeline", () => {
  test("filters by local day, ISO week, month, and all", () => {
    expect(filterPluginTimelineItems(items, "today", now).map(({ id }) => id)).toEqual([
      "today",
    ]);
    expect(filterPluginTimelineItems(items, "week", now).map(({ id }) => id)).toEqual([
      "today",
      "yesterday",
      "week",
    ]);
    expect(filterPluginTimelineItems(items, "month", now).map(({ id }) => id)).toEqual([
      "today",
      "yesterday",
      "week",
      "month",
    ]);
    expect(filterPluginTimelineItems(items, "all", now).map(({ id }) => id)).toEqual([
      "today",
      "yesterday",
      "week",
      "month",
      "previous-month",
      "unknown",
    ]);
  });

  test("groups the sorted list into host-labelled calendar days", () => {
    const sections = groupPluginTimelineItems(
      filterPluginTimelineItems(items, "all", now),
      "en-US",
      { today: "Today", yesterday: "Yesterday", unknownDate: "Unknown date" },
      now,
    );

    expect(sections.map(({ key }) => key)).toEqual([
      "2026-7-24",
      "2026-7-23",
      "2026-7-20",
      "2026-7-3",
      "2026-6-30",
      "unknown",
    ]);
    expect(sections[0].label).toBe("Today");
    expect(sections[1].label).toBe("Yesterday");
    expect(sections[sections.length - 1]?.label).toBe("Unknown date");
  });
});
