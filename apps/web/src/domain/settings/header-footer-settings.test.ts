import { beforeEach, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { headerFooterSettingsAtom, readerOverridesAtom, readerPreferencesAtom } from "../../state/ui";
import {
  HEADER_FOOTER_SETTINGS_KEY,
  defaultHeaderFooterSettings,
  getHeaderFooterSettings,
  type HeaderFooterSettings,
} from "./header-footer-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { DEFAULT_READER_PREFERENCES } from "../../features/settings/lib/reader-settings";
import { localKV } from "../../platform/local-store";
import { createSettingsDomain } from "./domain";
import { installFileGlobals, memoryStorage } from "../../../tests/helpers/file-globals";

const disk = new Map<string, string>();
installFileGlobals({ localStorage: memoryStorage(disk) });
const store = getDefaultStore();
const PATHS = [
  "menus.headerFooter.enabled",
  "menus.headerFooter.header-left",
  "menus.headerFooter.header-center",
  "menus.headerFooter.header-right",
  "menus.headerFooter.footer-left",
  "menus.headerFooter.footer-center",
  "menus.headerFooter.footer-right",
];

beforeEach(async () => {
  await localKV.setItemAsync(HEADER_FOOTER_SETTINGS_KEY, JSON.stringify(defaultHeaderFooterSettings()));
  await localKV.setItemAsync(READER_OVERRIDES_KEY, JSON.stringify({}));
});

test("the Agent discovers header/footer paths as global-only menu settings", async () => {
  const snapshot = await createSettingsDomain("agent").queries.snapshot({ section: "menus" });
  const headerFooter = snapshot.settings.filter((setting) => setting.path.startsWith("menus.headerFooter."));
  expect(headerFooter.map((setting) => [setting.path, setting.kind, setting.supportedTargets])).toEqual([
    ["menus.headerFooter.enabled", "boolean", ["global"]],
    ["menus.headerFooter.header-left", "id-list", ["global"]],
    ["menus.headerFooter.header-center", "id-list", ["global"]],
    ["menus.headerFooter.header-right", "id-list", ["global"]],
    ["menus.headerFooter.footer-left", "id-list", ["global"]],
    ["menus.headerFooter.footer-center", "id-list", ["global"]],
    ["menus.headerFooter.footer-right", "id-list", ["global"]],
  ]);
  for (const setting of headerFooter.slice(1)) {
    expect(setting.options?.map((option) => option.value)).toEqual([
      "chapter",
      "bookTitle",
      "progress",
      "pages",
      "time",
      "battery",
    ]);
    // Device-local chrome is not book-scoped, so it carries no book-override metadata.
    expect(setting.reading).toBeUndefined();
  }
});

test("an Agent update persists every path and reaches the live atom", async () => {
  await createSettingsDomain("agent").commands.update([
    { path: "menus.headerFooter.enabled", value: true },
    { path: "menus.headerFooter.header-center", value: ["chapter", "bookTitle"] },
    { path: "menus.headerFooter.footer-right", value: ["battery", "progress"] },
  ]);
  const expected: HeaderFooterSettings = {
    enabled: true,
    slots: {
      // Adopting chapter into header-center moves it out of header-left;
      // adopting battery/progress into footer-right empties footer-left of them.
      "header-left": [],
      "header-center": ["chapter", "bookTitle"],
      "header-right": [],
      "footer-left": ["time"],
      "footer-center": [],
      "footer-right": ["battery", "progress"],
    },
  };
  expect(store.get(headerFooterSettingsAtom)).toEqual(expected);
  expect(getHeaderFooterSettings()).toEqual(expected);
  expect(JSON.parse(disk.get(HEADER_FOOTER_SETTINGS_KEY)!)).toEqual(expected);
  // Header/footer never leaks into the per-book reader preference record.
  expect(store.get(readerPreferencesAtom)).not.toHaveProperty("headerFooter");
});

test("invalid values, book targets and ungranted plugins leave the settings unchanged", async () => {
  const before = store.get(headerFooterSettingsAtom);
  const agent = createSettingsDomain("agent");
  await expect(
    agent.commands.update([{ path: "menus.headerFooter.header-left", value: "header-middle" }]),
  ).rejects.toThrow();
  await expect(agent.commands.update([{ path: "menus.headerFooter.header-left", value: ["bogus"] }])).rejects.toThrow();
  await expect(
    agent.commands.update([{ path: "menus.headerFooter.header-left", value: ["time", "time"] }]),
  ).rejects.toThrow();
  await expect(agent.commands.update([{ path: "menus.headerFooter.enabled", value: "yes" }])).rejects.toThrow();
  await expect(
    agent.commands.update([
      {
        path: "menus.headerFooter.footer-left",
        value: ["time"],
        target: { kind: "book", bookId: "one" },
      },
    ]),
  ).rejects.toThrow();
  await expect(
    agent.commands.update([{ path: "menus.headerFooter.enabled", value: true, target: { kind: "all-books" } }]),
  ).rejects.toThrow();
  await expect(
    createSettingsDomain("plugin:none").commands.update([{ path: "menus.headerFooter.footer-left", value: [] }]),
  ).rejects.toThrow();
  expect(store.get(headerFooterSettingsAtom)).toEqual(before);
});

test("a granted plugin can change the strips through the same catalog", async () => {
  await createSettingsDomain("plugin:input", { write: ["menus.headerFooter.*"] }).commands.update([
    { path: "menus.headerFooter.header-right", value: ["bookTitle"] },
  ]);
  expect(store.get(headerFooterSettingsAtom).slots["header-right"]).toEqual(["bookTitle"]);
});

test("book overrides never claim to shadow header/footer paths", async () => {
  store.set(readerOverridesAtom, { book: { scope: "book", settings: { ...DEFAULT_READER_PREFERENCES } } });
  const snapshot = await createSettingsDomain("agent").queries.snapshot({ section: "reading" });
  const shadowed = snapshot.overrides.flatMap((override) => override.paths);
  expect(shadowed).toContain("reading.fontSize");
  for (const path of PATHS) expect(shadowed).not.toContain(path);
});

test("a reading reset keeps header/footer preferences", async () => {
  const agent = createSettingsDomain("agent");
  await agent.commands.update([{ path: "menus.headerFooter.header-right", value: ["time"] }]);
  await agent.commands.resetReading({ action: "defaults", target: { kind: "global" } });
  expect(store.get(headerFooterSettingsAtom).slots["header-right"]).toEqual(["time"]);
});

test("external persisted writes refresh the atom, and corrupt records read as defaults", async () => {
  const defaults = defaultHeaderFooterSettings();
  await localKV.setItemAsync(
    HEADER_FOOTER_SETTINGS_KEY,
    JSON.stringify({
      enabled: true,
      slots: { "footer-left": ["chapter", "time"], "footer-center": ["pages"] },
    }),
  );
  expect(store.get(headerFooterSettingsAtom)).toEqual({
    enabled: true,
    slots: {
      "header-left": [],
      "header-center": [],
      "header-right": [],
      "footer-left": ["chapter", "time"],
      "footer-center": ["pages"],
      "footer-right": [],
    },
  });
  await localKV.setItemAsync(
    HEADER_FOOTER_SETTINGS_KEY,
    JSON.stringify({ enabled: "always", slots: { "header-left": ["sideways"] } }),
  );
  expect(store.get(headerFooterSettingsAtom)).toEqual({
    ...defaults,
    slots: {
      "header-left": [],
      "header-center": [],
      "header-right": [],
      "footer-left": [],
      "footer-center": [],
      "footer-right": [],
    },
  });
});
