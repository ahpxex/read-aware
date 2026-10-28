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
  "reading.headerFooter.enabled",
  "reading.headerFooter.items.chapter",
  "reading.headerFooter.items.bookTitle",
  "reading.headerFooter.items.progress",
  "reading.headerFooter.items.pages",
  "reading.headerFooter.items.time",
  "reading.headerFooter.items.battery",
];

beforeEach(async () => {
  await localKV.setItemAsync(HEADER_FOOTER_SETTINGS_KEY, JSON.stringify(defaultHeaderFooterSettings()));
  await localKV.setItemAsync(READER_OVERRIDES_KEY, JSON.stringify({}));
});

test("the Agent discovers header/footer paths as global-only reading settings", async () => {
  const snapshot = await createSettingsDomain("agent").queries.snapshot({ section: "reading" });
  const headerFooter = snapshot.settings.filter((setting) => setting.path.startsWith("reading.headerFooter."));
  expect(headerFooter.map((setting) => [setting.path, setting.kind, setting.supportedTargets])).toEqual([
    ["reading.headerFooter.enabled", "boolean", ["global"]],
    ["reading.headerFooter.items.chapter", "enum", ["global"]],
    ["reading.headerFooter.items.bookTitle", "enum", ["global"]],
    ["reading.headerFooter.items.progress", "enum", ["global"]],
    ["reading.headerFooter.items.pages", "enum", ["global"]],
    ["reading.headerFooter.items.time", "enum", ["global"]],
    ["reading.headerFooter.items.battery", "enum", ["global"]],
  ]);
  const slotValues = [
    "hidden",
    "header-left",
    "header-center",
    "header-right",
    "footer-left",
    "footer-center",
    "footer-right",
  ];
  for (const setting of headerFooter.slice(1)) {
    expect(setting.options?.map((option) => option.value)).toEqual(slotValues);
    // Device-local chrome is not book-scoped, so it carries no book-override metadata.
    expect(setting.reading).toBeUndefined();
  }
});

test("an Agent update persists every path and reaches the live atom", async () => {
  await createSettingsDomain("agent").commands.update([
    { path: "reading.headerFooter.enabled", value: true },
    { path: "reading.headerFooter.items.chapter", value: "header-center" },
    { path: "reading.headerFooter.items.battery", value: "footer-right" },
  ]);
  const expected: HeaderFooterSettings = {
    enabled: true,
    items: {
      ...defaultHeaderFooterSettings().items,
      chapter: "header-center",
      battery: "footer-right",
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
    agent.commands.update([{ path: "reading.headerFooter.items.chapter", value: "header-middle" }]),
  ).rejects.toThrow();
  await expect(agent.commands.update([{ path: "reading.headerFooter.enabled", value: "yes" }])).rejects.toThrow();
  await expect(
    agent.commands.update([
      {
        path: "reading.headerFooter.items.time",
        value: "footer-left",
        target: { kind: "book", bookId: "one" },
      },
    ]),
  ).rejects.toThrow();
  await expect(
    agent.commands.update([{ path: "reading.headerFooter.enabled", value: true, target: { kind: "all-books" } }]),
  ).rejects.toThrow();
  await expect(
    createSettingsDomain("plugin:none").commands.update([
      { path: "reading.headerFooter.items.chapter", value: "hidden" },
    ]),
  ).rejects.toThrow();
  expect(store.get(headerFooterSettingsAtom)).toEqual(before);
});

test("a granted plugin can change the strips through the same catalog", async () => {
  await createSettingsDomain("plugin:input", { write: ["reading.headerFooter.*"] }).commands.update([
    { path: "reading.headerFooter.items.bookTitle", value: "header-right" },
  ]);
  expect(store.get(headerFooterSettingsAtom).items.bookTitle).toBe("header-right");
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
  await agent.commands.update([{ path: "reading.headerFooter.items.time", value: "header-right" }]);
  await agent.commands.resetReading({ action: "defaults", target: { kind: "global" } });
  expect(store.get(headerFooterSettingsAtom).items.time).toBe("header-right");
});

test("external persisted writes refresh the atom, and corrupt records read as defaults", async () => {
  const defaults = defaultHeaderFooterSettings();
  await localKV.setItemAsync(
    HEADER_FOOTER_SETTINGS_KEY,
    JSON.stringify({ enabled: true, items: { chapter: "footer-left", pages: "footer-center" } }),
  );
  expect(store.get(headerFooterSettingsAtom)).toEqual({
    enabled: true,
    items: { ...defaults.items, chapter: "footer-left", pages: "footer-center" },
  });
  await localKV.setItemAsync(
    HEADER_FOOTER_SETTINGS_KEY,
    JSON.stringify({ enabled: "always", items: { chapter: "sideways" } }),
  );
  expect(store.get(headerFooterSettingsAtom)).toEqual(defaults);
});
