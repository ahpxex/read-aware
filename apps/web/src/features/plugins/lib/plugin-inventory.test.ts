import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { pluginInventoryOf } from "./plugin-inventory";
import type { InstalledPlugin } from "./plugin-types";

const plugin = (id: string, extra: Partial<InstalledPlugin>): InstalledPlugin =>
  ({ manifest: { id, version: "1.2.0" }, enabled: true, ...extra }) as InstalledPlugin;

test("lists identity, provenance and failure codes, never settings or grants", () => {
  expect(
    pluginInventoryOf([
      plugin("tts", { builtin: true, bookAccess: { mode: "book", bookId: "b1" } }),
      plugin("webdav-sync", { installSource: "local", enabled: false }),
      plugin("old", {}),
      plugin("broken", { installSource: "marketplace", error: new AppError("plugin/activation-failed", "boom") }),
      plugin("thrown", { installSource: "marketplace", error: new Error("no code") }),
    ]),
  ).toEqual([
    { id: "tts", version: "1.2.0", enabled: true, source: "builtin" },
    { id: "webdav-sync", version: "1.2.0", enabled: false, source: "local" },
    { id: "old", version: "1.2.0", enabled: true, source: "unknown" },
    { id: "broken", version: "1.2.0", enabled: true, source: "marketplace", failure: "plugin/activation-failed" },
    { id: "thrown", version: "1.2.0", enabled: true, source: "marketplace", failure: "unknown" },
  ]);
});
