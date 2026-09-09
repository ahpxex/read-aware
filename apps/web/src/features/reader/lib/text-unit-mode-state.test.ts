import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

import {
  DEFAULT_TEXT_UNIT_MODE_SETTINGS,
  isTextUnitModeStateCompatible,
  normalizeTextUnitModeState,
  readTextUnitModeSettings,
  updateTextUnitModeSettings,
} from "./text-unit-mode-state";

const MODE_KEY = "sentence-reader:guided-reading";
const PLUGIN_SETTINGS_KEY = "read-aware-plugin.sentence-reader.settings";
const LEGACY_PREFS_KEY = "read-aware-navigator-prefs";

beforeEach(() => storage.clear());

describe("text-unit mode state migrations", () => {
  test("treats state older than granularity as sentence-based", () => {
    expect(normalizeTextUnitModeState({
      active: true,
      resting: { sectionIndex: 4, ordinal: 8, cfiRange: "epubcfi(/6/4)" },
    })).toEqual({
      active: true,
      resting: { sectionIndex: 4, ordinal: 8, cfiRange: "epubcfi(/6/4)" },
      modeKey: null,
      unitId: "sentence",
      contentVersion: null,
    });
  });

  test("keeps contribution identity with arbitrary valid plugin unit ids", () => {
    const state = normalizeTextUnitModeState({
      active: true,
      modeKey: "paced-reader:guided-reading",
      unitId: "stanza",
      contentVersion: "v1",
    });

    expect(
      isTextUnitModeStateCompatible(state, "paced-reader:guided-reading", "stanza", "v1"),
    ).toBe(true);
    expect(
      isTextUnitModeStateCompatible(state, "other-reader:guided-reading", "stanza", "v1"),
    ).toBe(false);
    expect(isTextUnitModeStateCompatible(state, "paced-reader:guided-reading", "stanza", "v2")).toBe(false);
    expect(isTextUnitModeStateCompatible(state, "paced-reader:guided-reading", "stanza", null)).toBe(false);
    expect(isTextUnitModeStateCompatible({ ...state, contentVersion: null }, "paced-reader:guided-reading", "stanza", "v1")).toBe(false);
  });

  test("invalid persisted ordinals cannot become a unit address", () => {
    for (const ordinal of [-1, 0.5, Number.POSITIVE_INFINITY]) {
      expect(normalizeTextUnitModeState({ resting: { ordinal, sectionIndex: 0 } }).resting).toBeNull();
    }
  });
});

describe("text-unit mode settings (plugin-owned)", () => {
  test("falls back to defaults without a mode or stored values", () => {
    expect(readTextUnitModeSettings(null)).toEqual(DEFAULT_TEXT_UNIT_MODE_SETTINGS);
    expect(readTextUnitModeSettings(MODE_KEY)).toEqual(DEFAULT_TEXT_UNIT_MODE_SETTINGS);
  });

  test("reads well-known fields from the plugin's settings object", () => {
    storage.set(
      PLUGIN_SETTINGS_KEY,
      JSON.stringify({
        unitId: "paragraph",
        tapToAdvance: false,
        scrollToStep: true,
        showProgress: false,
        sessionTimer: false,
      }),
    );

    expect(readTextUnitModeSettings(MODE_KEY)).toEqual({
      unitId: "paragraph",
      tapToAdvance: false,
      scrollToStep: true,
      showProgress: false,
      sessionTimer: false,
    });
  });

  test("reading preserves legacy prefs; explicit settings commit migrates them", async () => {
    storage.set(
      LEGACY_PREFS_KEY,
      JSON.stringify({
        modeKey: MODE_KEY,
        granularity: "paragraph",
        tapToAdvance: false,
        scrollToStep: true,
      }),
    );

    expect(readTextUnitModeSettings(MODE_KEY)).toEqual({
      unitId: "paragraph",
      tapToAdvance: false,
      scrollToStep: true,
      showProgress: DEFAULT_TEXT_UNIT_MODE_SETTINGS.showProgress,
      sessionTimer: DEFAULT_TEXT_UNIT_MODE_SETTINGS.sessionTimer,
    });
    expect(storage.has(LEGACY_PREFS_KEY)).toBe(true);
    expect(storage.has(PLUGIN_SETTINGS_KEY)).toBe(false);
    await updateTextUnitModeSettings(MODE_KEY, {});
    expect(storage.has(LEGACY_PREFS_KEY)).toBe(false);
    // The migrated values now live in the plugin's settings object.
    expect(JSON.parse(storage.get(PLUGIN_SETTINGS_KEY) ?? "{}")).toMatchObject({
      unitId: "paragraph",
      tapToAdvance: false,
      scrollToStep: true,
    });
  });

  test("migration never overwrites values the plugin object already has", () => {
    storage.set(PLUGIN_SETTINGS_KEY, JSON.stringify({ unitId: "sentence" }));
    storage.set(
      LEGACY_PREFS_KEY,
      JSON.stringify({ unitId: "paragraph", tapToAdvance: false }),
    );

    expect(readTextUnitModeSettings(MODE_KEY)).toMatchObject({
      unitId: "sentence",
      tapToAdvance: false,
    });
  });

  test("another mode cannot consume or copy the legacy owner's preferences", async () => {
    storage.set(
      LEGACY_PREFS_KEY,
      JSON.stringify({ modeKey: "other-reader:guided-reading", unitId: "stanza", tapToAdvance: false }),
    );

    expect(readTextUnitModeSettings(MODE_KEY).unitId).toBeNull();
    expect(readTextUnitModeSettings(MODE_KEY).tapToAdvance).toBe(true);
    await updateTextUnitModeSettings(MODE_KEY, { showProgress: false });
    expect(storage.has(LEGACY_PREFS_KEY)).toBe(true);
    await updateTextUnitModeSettings("other-reader:guided-reading", {});
    expect(storage.has(LEGACY_PREFS_KEY)).toBe(false);
    expect(readTextUnitModeSettings("other-reader:guided-reading")).toMatchObject({ unitId: "stanza", tapToAdvance: false });
  });

  test("updates merge a patch into the stored object", async () => {
    storage.set(PLUGIN_SETTINGS_KEY, JSON.stringify({ unitId: "sentence", other: "kept" }));

    await updateTextUnitModeSettings(MODE_KEY, { showProgress: false, unitId: "paragraph" });

    expect(JSON.parse(storage.get(PLUGIN_SETTINGS_KEY) ?? "{}")).toEqual({
      unitId: "paragraph",
      other: "kept",
      showProgress: false,
    });
  });

  test("malformed legacy data is never consumed by reads and only discarded by a commit", async () => {
    for (const raw of ["broken", "null", "[]", "123"]) {
      storage.set(LEGACY_PREFS_KEY, raw);
      expect(readTextUnitModeSettings(MODE_KEY)).toEqual(DEFAULT_TEXT_UNIT_MODE_SETTINGS);
      expect(storage.get(LEGACY_PREFS_KEY)).toBe(raw);
      await updateTextUnitModeSettings(MODE_KEY, {});
      expect(storage.has(LEGACY_PREFS_KEY)).toBe(false);
    }
  });
});
