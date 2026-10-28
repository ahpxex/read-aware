import { expect, test } from "bun:test";
import {
  defaultHeaderFooterSettings,
  normalizeHeaderFooterSettings,
  type HeaderFooterSettings,
} from "../../../domain/settings/header-footer-settings";
import { resolveHeaderFooterLayout } from "./header-footer-layout";

const settings = (overrides: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings => ({
  enabled: true,
  items: { ...defaultHeaderFooterSettings().items },
  ...overrides,
});

test("normalize validates each item's slot against the known slots", () => {
  const defaults = settings({ enabled: false });
  expect(
    normalizeHeaderFooterSettings(
      {
        enabled: true,
        items: { chapter: "header-right", time: "everywhere", battery: "footer-center" },
      },
      defaults,
    ),
  ).toEqual({
    enabled: true,
    items: { ...defaults.items, chapter: "header-right", battery: "footer-center" },
  });
  expect(normalizeHeaderFooterSettings("garbage", defaults)).toEqual(defaults);
  expect(normalizeHeaderFooterSettings({ items: null }, defaults)).toEqual(defaults);
  // A non-boolean enabled falls back to the caller's platform default.
  expect(normalizeHeaderFooterSettings({ enabled: "yes" }, defaults)).toEqual(defaults);
});

test("the layout groups items per slot in item order", () => {
  const layout = resolveHeaderFooterLayout(settings(), { batteryAvailable: true });
  expect(layout.header).toEqual({ left: ["chapter"], center: [], right: [] });
  // time precedes battery in HEADER_FOOTER_ITEMS order.
  expect(layout.footer).toEqual({ left: ["time", "battery"], center: [], right: ["progress"] });
});

test("battery drops out where the platform cannot report it", () => {
  const layout = resolveHeaderFooterLayout(settings(), { batteryAvailable: false });
  expect(layout.footer?.left).toEqual(["time"]);
  const onlyBattery = settings({ items: { ...settings().items, time: "hidden" } });
  expect(resolveHeaderFooterLayout(onlyBattery, { batteryAvailable: false }).footer).toEqual({
    left: [],
    center: [],
    right: ["progress"],
  });
});

test("disabled or empty bands reserve no space", () => {
  expect(resolveHeaderFooterLayout(settings({ enabled: false }), { batteryAvailable: true })).toEqual({
    header: null,
    footer: null,
  });
  const allHidden = settings({
    items: {
      chapter: "hidden",
      bookTitle: "hidden",
      progress: "hidden",
      pages: "hidden",
      time: "hidden",
      battery: "hidden",
    },
  });
  expect(resolveHeaderFooterLayout(allHidden, { batteryAvailable: true })).toEqual({
    header: null,
    footer: null,
  });
});
