import { beforeEach, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { readerPreferencesAtom, selectionSettingsAtom } from "../../state/ui";
import { DEFAULT_SELECTION_SETTINGS, SELECTION_SETTINGS_KEY, getSelectionSettings } from "./selection-settings";
import { localKV } from "../../platform/local-store";
import { createSettingsDomain } from "./domain";
import { installFileGlobals, memoryStorage } from "../../../tests/helpers/file-globals";

const disk = new Map<string, string>();
installFileGlobals({ localStorage: memoryStorage(disk) });
const store = getDefaultStore();
const PATH = "reading.selection.snapToText";

beforeEach(async () => {
  await localKV.setItemAsync(SELECTION_SETTINGS_KEY, JSON.stringify(DEFAULT_SELECTION_SETTINGS));
});

test("smart selection is on by default and discoverable as a global-only reading setting", async () => {
  const snapshot = await createSettingsDomain("agent").queries.snapshot({ section: "reading" });
  const setting = snapshot.settings.find((entry) => entry.path === PATH);
  expect(setting?.value).toBe(true);
  expect(setting?.supportedTargets).toEqual(["global"]);
  expect(setting?.reading).toBeUndefined();
});

test("an Agent update persists and reaches the live atom, outside the per-book preferences", async () => {
  await createSettingsDomain("agent").commands.update([{ path: PATH, value: false }]);
  expect(store.get(selectionSettingsAtom)).toEqual({ snapToText: false });
  expect(getSelectionSettings()).toEqual({ snapToText: false });
  expect(JSON.parse(disk.get(SELECTION_SETTINGS_KEY)!)).toEqual({ snapToText: false });
  expect(store.get(readerPreferencesAtom)).not.toHaveProperty("snapToText");
});

test("invalid values and book targets are rejected", async () => {
  const agent = createSettingsDomain("agent");
  await expect(agent.commands.update([{ path: PATH, value: "yes" }])).rejects.toThrow();
  await expect(
    agent.commands.update([{ path: PATH, value: false, target: { kind: "book", bookId: "one" } }]),
  ).rejects.toThrow();
  expect(store.get(selectionSettingsAtom)).toEqual(DEFAULT_SELECTION_SETTINGS);
});

test("a reading reset keeps the selection preference", async () => {
  const agent = createSettingsDomain("agent");
  await agent.commands.update([{ path: PATH, value: false }]);
  await agent.commands.resetReading({ action: "defaults", target: { kind: "global" } });
  expect(store.get(selectionSettingsAtom).snapToText).toBe(false);
});

test("external writes refresh the atom, and corrupt records read as the default", async () => {
  await localKV.setItemAsync(SELECTION_SETTINGS_KEY, JSON.stringify({ snapToText: false }));
  expect(store.get(selectionSettingsAtom)).toEqual({ snapToText: false });
  await localKV.setItemAsync(SELECTION_SETTINGS_KEY, JSON.stringify({ snapToText: 1 }));
  expect(store.get(selectionSettingsAtom)).toEqual(DEFAULT_SELECTION_SETTINGS);
});
