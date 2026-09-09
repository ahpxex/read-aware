import { expect, test } from "bun:test";
import { assertShortcutChanges, shortcutConflicts, shortcutFromTokens, shortcutRows, shortcutSettingPath, shortcutTokens } from "./shortcut-catalog";
const env = { commands: [{ key: "sample:open", title: "Open sample", defaultShortcut: { mod: true, key: "o" } }], modeAvailable: true, lookupAvailable: true };

test("normalizes chord arrays without conflating literal keys and modifiers", () => {
  expect(shortcutTokens(shortcutFromTokens(["shift", "mod", "K"]))).toEqual(["mod", "shift", "k"]);
  expect(shortcutFromTokens(["+"])).toEqual({ key: "+" });
  expect(shortcutFromTokens([" "])).toEqual({ key: " " });
  for (const value of [[], ["mod"], ["Escape"], ["Control", "k"], ["mod", "mod", "k"], ["ctrl", "k"], ["Shift"], ["\n"], ["Dead"], [2]]) {
    expect(() => shortcutFromTokens(value)).toThrow("Expected modifier tokens");
  }
});
test("encodes opaque plugin IDs without granting wildcard or nested paths", () => {
  expect(shortcutSettingPath("search")).toBe("shortcuts.search");
  expect(shortcutSettingPath("plugin:sample:open.*")).toBe("shortcuts.plugin.sample%3Aopen%2E%2A");
  expect(shortcutSettingPath("plugin:sample:open%2E*")).not.toBe(shortcutSettingPath("plugin:sample:open.*"));
});
test("registered plugin defaults, overrides and dormant builtins share one catalog", () => {
  const rows = shortcutRows({ "plugin:sample:open": { mod: true, key: "p" } }, { ...env, modeAvailable: false });
  expect(rows.find(row => row.id === "plugin:sample:open")).toMatchObject({ overridden: true, binding: { mod: true, key: "p" }, defaultBinding: { mod: true, key: "o" } });
  expect(rows.find(row => row.id === "reader-mode-next-unit")?.available).toBe(false);
});
test("validates final state rather than rejecting intermediate swaps", () => {
  expect(() => assertShortcutChanges({}, { search: { mod: true, key: "," }, settings: { mod: true, key: "k" } }, env)).not.toThrow();
  expect(() => assertShortcutChanges({}, { search: { mod: true, key: "o" } }, env)).toThrow("Shortcut conflict");
});
test("restoring a default cannot silently collide, unrelated legacy conflicts do not block repairs", () => {
  const before = { search: { mod: true, key: "p" }, settings: { mod: true, key: "k" } };
  expect(() => assertShortcutChanges(before, { settings: before.settings }, env)).toThrow("Shortcut conflict");
  const legacy = { search: { mod: true, key: "o" } };
  expect(() => assertShortcutChanges(legacy, { ...legacy, settings: { mod: true, key: "p" } }, env)).not.toThrow();
  const rows = shortcutRows(legacy, env);
  expect(shortcutConflicts(rows.find(row => row.id === "search")!, rows).map(row => row.id)).toEqual(["plugin:sample:open"]);
});
