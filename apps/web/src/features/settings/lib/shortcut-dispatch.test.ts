import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { shortcutRows } from "./shortcut-catalog";
import { isAppSurfaceShortcut, resolveShortcutDispatch } from "./shortcut-dispatch";

const dom = new JSDOM("<!doctype html><input><div contenteditable><span></span></div>");
const event = (key: string, init: KeyboardEventInit = {}) => new dom.window.KeyboardEvent("keydown", { key, cancelable: true, ...init }) as unknown as KeyboardEvent;
const env = { commands: [], modeAvailable: false, lookupAvailable: false };

test("inactive mode or selection bindings retain the reader's vertical fallback", () => {
  const rows = shortcutRows({}, { ...env, modeAvailable: true });
  const decision = resolveShortcutDispatch(rows, event("ArrowDown"));
  expect(decision).toEqual({ kind: "command", id: "reader-mode-next-unit" });
  expect(isAppSurfaceShortcut("reader-mode-next-unit")).toBe(false);
  expect(isAppSurfaceShortcut("selection-copy")).toBe(false);
  expect(isAppSurfaceShortcut(undefined)).toBe(false);
  expect(isAppSurfaceShortcut("plugin:one:open")).toBe(true);
  expect(isAppSurfaceShortcut("search")).toBe(true);
});

test("activation and retirement cannot silently pick a conflict winner", () => {
  const overrides = { "plugin:retired:open": { mod: true, key: "k" } };
  expect(resolveShortcutDispatch(shortcutRows(overrides, env), event("k", { metaKey: true }))).toEqual({ kind: "command", id: "search" });
  const active = { ...env, commands: [{ key: "retired:open", title: "Retired" }] };
  const rows = shortcutRows(overrides, active);
  expect(resolveShortcutDispatch(rows, event("k", { metaKey: true }))).toEqual({ kind: "conflict", ids: ["search", "plugin:retired:open"] });
  expect(resolveShortcutDispatch(rows.toReversed(), event("k", { ctrlKey: true }))).toMatchObject({ kind: "conflict" });
  expect(resolveShortcutDispatch(shortcutRows({}, active), event("k", { ctrlKey: true }))).toEqual({ kind: "command", id: "search" });
});

test("provider availability uses the settings conflict space, not event listener order", () => {
  const commands = [
    { key: "one:step", title: "One", defaultShortcut: { key: "ArrowDown" } },
    { key: "two:step", title: "Two", defaultShortcut: { key: "ArrowDown" } },
  ];
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands }), event("ArrowDown"))).toMatchObject({ kind: "conflict" });
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands: commands.slice(0, 1) }), event("ArrowDown"))).toEqual({ kind: "command", id: "plugin:one:step" });
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands: commands.slice(0, 1), modeAvailable: true }), event("ArrowDown"))).toMatchObject({ kind: "conflict" });
  const lookup = [{ key: "one:lookup", title: "Lookup", defaultShortcut: { key: "l" } }];
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands: lookup, lookupAvailable: true }), event("l"))).toMatchObject({ kind: "conflict" });
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands: lookup }), event("l"))).toEqual({ kind: "command", id: "plugin:one:lookup" });
});

test("typing, composition, reserved Escape and claimed events do not run commands", () => {
  const commands = [{ key: "one:open", title: "One", defaultShortcut: { key: "h" } }];
  const rows = shortcutRows({}, { ...env, commands });
  for (const target of [dom.window.document.querySelector("input")!, dom.window.document.querySelector("span")!]) {
    const typing = event("h"); target.dispatchEvent(typing);
    expect(resolveShortcutDispatch(rows, typing)).toEqual({ kind: "none" });
    expect(typing.defaultPrevented).toBe(false);
  }
  expect(resolveShortcutDispatch(rows, event("k", { ctrlKey: true, isComposing: true }))).toEqual({ kind: "none" });
  const claimed = event("k", { ctrlKey: true }); claimed.preventDefault();
  expect(resolveShortcutDispatch(rows, claimed)).toEqual({ kind: "none" });
  expect(resolveShortcutDispatch(shortcutRows({}, { ...env, commands: [{ key: "bad:escape", title: "Escape", defaultShortcut: { key: "Escape" } }] }), event("Escape"))).toEqual({ kind: "none" });
  const globalConflict = event("k", { ctrlKey: true }); dom.window.document.querySelector("input")!.dispatchEvent(globalConflict);
  expect(resolveShortcutDispatch(shortcutRows({ "plugin:one:open": { mod: true, key: "k" } }, { ...env, commands }), globalConflict)).toMatchObject({ kind: "conflict" });
});
