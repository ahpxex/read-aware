import { expect, test } from "bun:test";
import {
  defaultHeaderFooterSettings,
  normalizeHeaderFooterSettings,
  type HeaderFooterSettings,
} from "../../../domain/settings/header-footer-settings";
import { resolveHeaderFooterLayout } from "./header-footer-layout";

const settings = (overrides: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings => ({
  enabled: true,
  slots: defaultHeaderFooterSettings().slots,
  ...overrides,
});

const EMPTY_SLOTS: HeaderFooterSettings["slots"] = {
  "header-left": [],
  "header-center": [],
  "header-right": [],
  "footer-left": [],
  "footer-center": [],
  "footer-right": [],
};

test("normalize keeps valid lists, drops unknown ids and non-arrays", () => {
  const defaults = settings({ enabled: false });
  expect(
    normalizeHeaderFooterSettings(
      {
        enabled: true,
        slots: { "header-left": ["chapter", "bogus"], "footer-left": "nope", "footer-right": ["progress"] },
      },
      defaults,
    ),
  ).toEqual({
    enabled: true,
    slots: { ...EMPTY_SLOTS, "header-left": ["chapter"], "footer-left": [], "footer-right": ["progress"] },
  });
  expect(normalizeHeaderFooterSettings("garbage", defaults)).toEqual(defaults);
  expect(normalizeHeaderFooterSettings({ slots: null }, defaults)).toEqual({
    ...defaults,
    slots: EMPTY_SLOTS,
  });
  expect(normalizeHeaderFooterSettings({ enabled: "yes" }, defaults)).toEqual({
    ...defaults,
    slots: EMPTY_SLOTS,
  });
});

test("normalize deduplicates across slots, first occurrence wins", () => {
  const defaults = settings();
  const next = normalizeHeaderFooterSettings(
    {
      enabled: true,
      slots: { "header-left": ["time"], "footer-left": ["time", "battery"], "header-right": ["battery"] },
    },
    defaults,
  );
  expect(next.slots["header-left"]).toEqual(["time"]);
  // header-right precedes footer-left in position order, so its battery wins.
  expect(next.slots["header-right"]).toEqual(["battery"]);
  expect(next.slots["footer-left"]).toEqual([]);
});

test("the layout reads each slot in stored order", () => {
  const custom = settings({
    slots: { ...EMPTY_SLOTS, "footer-left": ["battery", "time"], "header-right": ["chapter"] },
  });
  const layout = resolveHeaderFooterLayout(custom, { batteryAvailable: true });
  expect(layout.header).toEqual({ left: [], center: [], right: ["chapter"] });
  expect(layout.footer).toEqual({ left: ["battery", "time"], center: [], right: [] });
});

test("battery drops out where the platform cannot report it", () => {
  const layout = resolveHeaderFooterLayout(settings(), { batteryAvailable: false });
  expect(layout.footer?.left).toEqual(["time"]);
});

test("disabled or empty bands reserve no space", () => {
  expect(resolveHeaderFooterLayout(settings({ enabled: false }), { batteryAvailable: true })).toEqual({
    header: null,
    footer: null,
  });
  expect(resolveHeaderFooterLayout(settings({ slots: { ...EMPTY_SLOTS } }), { batteryAvailable: true })).toEqual({
    header: null,
    footer: null,
  });
});
