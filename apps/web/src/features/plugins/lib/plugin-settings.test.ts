import { beforeEach, describe, expect, test } from "bun:test";
import type { PluginManifest } from "./plugin-types";

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
  buildPluginSettingsView,
  readPluginSettingsValues,
} from "./plugin-settings";
import { parseManifestJson } from "./manifest";

const manifest: PluginManifest = {
  id: "settings-test",
  name: "Settings Test",
  version: "1.0.0",
  settings: [
    { kind: "text", id: "endpoint", label: "Endpoint", value: "https://example.com" },
    { kind: "toggle", id: "enabled", label: "Enabled", value: true },
  ],
};

beforeEach(() => storage.clear());

describe("plugin settings", () => {
  test("builds a reactive form and persists its complete value object", () => {
    const view = buildPluginSettingsView(manifest);

    expect(view?.submitMode).toBe("change");
    view?.onSubmit({ endpoint: "https://reader.example", enabled: false });

    expect(readPluginSettingsValues(manifest.id)).toEqual({
      endpoint: "https://reader.example",
      enabled: false,
    });
  });

  test("prefills the reactive form from stored values", () => {
    buildPluginSettingsView(manifest)?.onSubmit({
      endpoint: "https://saved.example",
      enabled: false,
    });

    const view = buildPluginSettingsView(manifest);
    expect(view?.fields).toEqual([
      {
        kind: "text",
        id: "endpoint",
        label: "Endpoint",
        value: "https://saved.example",
      },
      {
        kind: "toggle",
        id: "enabled",
        label: "Enabled",
        value: false,
      },
    ]);
  });
});

describe("time settings fields", () => {
  const base = {
    id: "time-test",
    name: "Time Test",
    version: "1.0.0",
    settings: [{ kind: "time", id: "start", label: "Starts at", value: "07:00" }],
  };

  test("a declared 24-hour value survives manifest validation", () => {
    const parsed = parseManifestJson(JSON.stringify(base));
    expect(parsed.settings?.[0]).toMatchObject({ kind: "time", value: "07:00" });
  });

  test("anything that is not a 24-hour HH:MM is rejected at install", () => {
    for (const value of ["7:00", "7pm", "24:00", "07:60", "0700", ""]) {
      const manifest = { ...base, settings: [{ ...base.settings[0], value }] };
      expect(() => parseManifestJson(JSON.stringify(manifest))).toThrow(/HH:MM/);
    }
  });

  test("the form prefills from the stored time, not the declared default", () => {
    storage.set(
      "read-aware-plugin.time-test.settings",
      JSON.stringify({ start: "21:30" }),
    );
    const view = buildPluginSettingsView(parseManifestJson(JSON.stringify(base)));
    expect(view?.fields[0]).toMatchObject({ value: "21:30" });
  });
});

describe("settings access manifest", () => {
  test("accepts exact paths and explicit section groups", () => {
    const parsed = parseManifestJson(
      JSON.stringify({
        id: "theme-schedule",
        name: "Theme Schedule",
        version: "1.0.0",
        settingsAccess: {
          read: ["appearance.theme"],
          write: ["appearance.*"],
        },
      }),
    );

    expect(parsed.settingsAccess).toEqual({
      read: ["appearance.theme"],
      write: ["appearance.*"],
    });
  });

  test("rejects blanket, malformed, and unknown access declarations", () => {
    for (const settingsAccess of [
      { write: ["*"] },
      { read: ["appearance..theme"] },
      { mutate: ["appearance.theme"] },
    ]) {
      expect(() =>
        parseManifestJson(
          JSON.stringify({
            id: "bad-access",
            name: "Bad Access",
            version: "1.0.0",
            settingsAccess,
          }),
        ),
      ).toThrow(/settingsAccess/);
    }
  });

  test("the retired appearance permission is no longer accepted", () => {
    expect(() =>
      parseManifestJson(
        JSON.stringify({
          id: "old-theme-switcher",
          name: "Old Theme Switcher",
          version: "1.0.0",
          permissions: ["ui:appearance"],
        }),
      ),
    ).toThrow(/unknown permission/);
  });
});
