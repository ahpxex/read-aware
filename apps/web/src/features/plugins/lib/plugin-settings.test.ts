import { beforeEach, describe, expect, test } from "bun:test";
import type { PluginManifest } from "./plugin-types";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
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
