import { beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { appSettingsAtom } from "../../state/ui";
import { DEFAULT_APP_SETTINGS } from "../../features/settings/lib/app-settings";
import { createSettingsDomain } from "./domain";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});

beforeEach(() => {
  storage.clear();
  getDefaultStore().set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS });
});

describe("Settings Domain actor policy", () => {
  test("grants a plugin exact discovery, read, write, and event paths", async () => {
    const settings = createSettingsDomain("plugin:test", {
      read: ["appearance.theme"],
      write: ["appearance.theme"],
    });
    const events: string[][] = [];
    const unsubscribe = settings.events.subscribe((event) => {
      events.push(event.changes.map((change) => change.path));
    });

    expect((await settings.queries.discover()).map((entry) => entry.path)).toEqual([
      "appearance.theme",
    ]);
    expect(await settings.queries.read("appearance.theme")).toMatchObject({
      path: "appearance.theme",
      value: DEFAULT_APP_SETTINGS.theme,
    });

    await settings.commands.update([
      { path: "appearance.theme", value: "light" },
    ]);

    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("light");
    expect(events).toEqual([["appearance.theme"]]);
    await expect(
      settings.commands.update([
        { path: "appearance.motion", value: "reduced" },
      ]),
    ).rejects.toThrow("settings write is not permitted");
    unsubscribe();
  });

  test("gives an ungranted plugin no settings surface", async () => {
    const settings = createSettingsDomain("plugin:test");

    expect(await settings.queries.discover()).toEqual([]);
    await expect(settings.queries.read("appearance.theme")).rejects.toThrow(
      "settings read is not permitted",
    );
  });
});
