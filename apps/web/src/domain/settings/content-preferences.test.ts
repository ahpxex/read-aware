import { beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { createSettingsDomain } from "./domain";
import { contentTypographyAtom, generalSettingsAtom, readerOverridesAtom, readerPreferencesAtom } from "../../state/ui";
import { DEFAULT_CONTENT_TYPOGRAPHY, getContentTypography, resolveContentTypography } from "../../features/settings/lib/content-typography";
import { DEFAULT_READER_PREFERENCES } from "../../features/settings/lib/reader-settings";
import { DEFAULT_GENERAL_SETTINGS } from "../../features/settings/lib/general-settings";
import { getDefaultMarkColor, setDefaultMarkColor } from "../../features/annotations/lib/annotation-prefs";
import { getUpdateChannel, setUpdateChannel, subscribeUpdateChannel } from "../../features/update/lib/update-channel";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
} });
const store = getDefaultStore();
beforeEach(async () => {
  storage.clear();
  store.set(contentTypographyAtom, { ...DEFAULT_CONTENT_TYPOGRAPHY });
  store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES });
  store.set(readerOverridesAtom, {});
  store.set(generalSettingsAtom, { ...DEFAULT_GENERAL_SETTINGS });
  await setDefaultMarkColor("yellow");
  setUpdateChannel("stable");
});

describe("shared content preferences", () => {
  test("discovers all nine paths with their actual options and scopes", async () => {
    const settings = createSettingsDomain("agent");
    const definitions = await settings.queries.discover();
    for (const path of ["reading.textAlign", "reading.fixedLayoutColor", "general.whatsNewDialog", "general.updateChannel", "annotations.defaultColor",
      ...["followReader", "fontFamily", "fontSize", "lineSpacing"].map(key => `appearance.contentTypography.${key}`)]) {
      expect(definitions.find(entry => entry.path === path)?.writable).toBe(true);
    }
    expect(definitions.find(entry => entry.path === "reading.textAlign")?.options?.map(option => option.value)).toEqual(["book", "start", "justify"]);
    expect(definitions.find(entry => entry.path === "appearance.contentTypography.fontFamily")?.nullable).toBe(true);
    expect(definitions.find(entry => entry.path === "annotations.defaultColor")?.supportedTargets).toEqual(["global"]);
  });

  test("uses reading overrides for both fields without changing other books", async () => {
    const settings = createSettingsDomain("agent");
    await settings.commands.update([
      { path: "reading.textAlign", value: "justify", target: { kind: "book", bookId: "one" } },
      { path: "reading.fixedLayoutColor", value: "original", target: { kind: "book", bookId: "one" } },
    ]);
    expect((await settings.queries.read("reading.textAlign", { kind: "book", bookId: "one" })).value).toBe("justify");
    expect((await settings.queries.read("reading.textAlign", { kind: "book", bookId: "two" })).value).toBe("book");
    await settings.commands.update([{ path: "reading.fixedLayoutColor", value: "theme", target: { kind: "all-books" } }]);
    expect((await settings.queries.read("reading.fixedLayoutColor", { kind: "book", bookId: "one" })).value).toBe("theme");
  });

  test("detaches content typography and restores real null/app-font semantics", async () => {
    const settings = createSettingsDomain("plugin:typography", { write: ["appearance.contentTypography.*"] });
    await settings.commands.update([
      { path: "appearance.contentTypography.followReader", value: false },
      { path: "appearance.contentTypography.fontFamily", value: "system:Georgia" },
      { path: "appearance.contentTypography.fontSize", value: "x-large" },
      { path: "appearance.contentTypography.lineSpacing", value: "relaxed" },
    ]);
    expect(resolveContentTypography(getContentTypography(), DEFAULT_READER_PREFERENCES)).toMatchObject({ fontSize: "1.0625rem", lineHeight: "1.9" });
    await settings.commands.update([{ path: "appearance.contentTypography.fontFamily", value: null }]);
    expect(store.get(contentTypographyAtom).fontFamily).toBeNull();
    expect(resolveContentTypography(getContentTypography(), DEFAULT_READER_PREFERENCES).fontFamily).toBeNull();
    await expect(settings.commands.update([{ path: "appearance.contentTypography.fontFamily", value: "plugin:missing:font" }])).rejects.toThrow();
  });

  test("writes scalar native encodings and refreshes an already subscribed update-channel view", async () => {
    const settings = createSettingsDomain("plugin:preferences", { write: ["annotations.defaultColor", "general.updateChannel", "general.whatsNewDialog"] });
    const seen: string[] = [];
    const unsubscribe = subscribeUpdateChannel(() => seen.push(getUpdateChannel()));
    try {
      const result = await settings.commands.update([
        { path: "annotations.defaultColor", value: "blue" },
        { path: "general.updateChannel", value: "beta" },
        { path: "general.whatsNewDialog", value: false },
      ]);
      expect(getDefaultMarkColor()).toBe("blue");
      expect(getUpdateChannel()).toBe("beta");
      expect(seen).toEqual(["beta"]);
      expect(store.get(generalSettingsAtom).whatsNewDialog).toBe(false);
      expect(result.settings.settings.map(entry => entry.path).sort()).toEqual(["annotations.defaultColor", "general.updateChannel", "general.whatsNewDialog"]);
    } finally { unsubscribe(); }
  });

  test("invalid ranges or targets reject the whole batch without mutating live preferences", async () => {
    const settings = createSettingsDomain("agent");
    await expect(settings.commands.update([
      { path: "appearance.contentTypography.followReader", value: false },
      { path: "annotations.defaultColor", value: "red" },
    ])).rejects.toThrow();
    expect(getContentTypography().followReader).toBe(true);
    await expect(settings.commands.update([{ path: "appearance.contentTypography.fontSize", value: "xxx-large" }])).rejects.toThrow();
    await expect(settings.commands.update([{ path: "general.updateChannel", value: "beta", target: { kind: "book", bookId: "one" } }])).rejects.toThrow();
    expect(getUpdateChannel()).toBe("stable");
  });
});
