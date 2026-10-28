import { describe, expect, test } from "bun:test";
import {
  hideHeaderFooterItem,
  hiddenHeaderFooterItems,
  moveHeaderFooterItem,
  showHeaderFooterItem,
} from "./header-footer-arrangement";
import type { HeaderFooterSettings } from "../../../domain/settings/header-footer-settings";

const base: HeaderFooterSettings = {
  enabled: true,
  slots: {
    "header-left": ["chapter"],
    "header-center": [],
    "header-right": [],
    "footer-left": ["time", "battery"],
    "footer-center": [],
    "footer-right": ["progress"],
  },
};

function allItems(s: HeaderFooterSettings) {
  return Object.values(s.slots).flat();
}

describe("moveHeaderFooterItem", () => {
  test("reorders within a slot", () => {
    const next = moveHeaderFooterItem(base, "battery", "footer-left", "time");
    expect(next.slots["footer-left"]).toEqual(["battery", "time"]);
  });

  test("moves across slots", () => {
    const next = moveHeaderFooterItem(base, "time", "header-right", null);
    expect(next.slots["footer-left"]).toEqual(["battery"]);
    expect(next.slots["header-right"]).toEqual(["time"]);
  });

  test("moves to hidden", () => {
    const next = moveHeaderFooterItem(base, "chapter", "hidden", null);
    expect(allItems(next)).not.toContain("chapter");
  });

  test("inserts before a specific item", () => {
    const next = moveHeaderFooterItem(base, "chapter", "footer-left", "battery");
    expect(next.slots["footer-left"]).toEqual(["time", "chapter", "battery"]);
  });

  test("missing before-item appends", () => {
    const next = moveHeaderFooterItem(base, "chapter", "footer-left", "pages");
    expect(next.slots["footer-left"]).toEqual(["time", "battery", "chapter"]);
  });

  test("moving onto itself is a no-op", () => {
    // Before the item it already precedes: same arrangement.
    expect(moveHeaderFooterItem(base, "time", "footer-left", "battery").slots).toEqual(base.slots);
    expect(moveHeaderFooterItem(base, "progress", "footer-right", null)).toBe(base);
  });

  test("never duplicates", () => {
    const seeded = {
      ...base,
      slots: { ...base.slots, "header-right": ["time" as const] },
    };
    const next = moveHeaderFooterItem(seeded, "time", "footer-left", null);
    expect(allItems(next).filter((i) => i === "time")).toHaveLength(1);
  });
});

describe("show/hide", () => {
  test("show uses the show position and appends", () => {
    const next = showHeaderFooterItem(base, "bookTitle");
    expect(next.slots["header-center"]).toEqual(["bookTitle"]);
    const next2 = showHeaderFooterItem(base, "pages");
    expect(next2.slots["footer-center"]).toEqual(["pages"]);
  });

  test("hide removes from everywhere", () => {
    const next = hideHeaderFooterItem(base, "battery");
    expect(allItems(next)).not.toContain("battery");
  });

  test("hidden list follows catalog order", () => {
    const next = hideHeaderFooterItem(base, "time");
    const hidden = hiddenHeaderFooterItems(next);
    expect(hidden).toEqual(["bookTitle", "pages", "time"]);
  });

  test("hidden list respects availability", () => {
    const hidden = hiddenHeaderFooterItems(base, ["chapter", "time"]);
    expect(hidden).toEqual([]);
  });
});
