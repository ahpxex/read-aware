import { afterEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PluginViewResult } from "./plugin-types";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { runPluginContribution } = await import("./run-result");
const { closePluginDialog, pluginDialogAtom } = await import("../state/plugin-store");
const store = getDefaultStore();

afterEach(() => {
  store.set(pluginDialogAtom, null);
});

describe("runPluginContribution", () => {
  test("opens a pending Dialog before an async view resolves", async () => {
    let finish!: (result: PluginViewResult) => void;
    const completion = runPluginContribution(
      "dictionary",
      "Dictionary",
      () => new Promise((resolve) => { finish = resolve; }),
      { presentation: "dialog" },
    );

    const pending = store.get(pluginDialogAtom);
    expect(pending?.pluginId).toBe("dictionary");
    expect(pending?.view).toBeNull();

    const view = { kind: "markdown" as const, markdown: "Ready" };
    finish({ view });
    await completion;

    const resolved = store.get(pluginDialogAtom);
    expect(resolved?.requestId).toBe(pending?.requestId);
    expect(resolved?.view).toEqual(view);
  });

  test("does not reopen a Dialog that was closed while loading", async () => {
    let finish!: (result: PluginViewResult) => void;
    const completion = runPluginContribution(
      "dictionary",
      "Dictionary",
      () => new Promise((resolve) => { finish = resolve; }),
      { presentation: "dialog" },
    );

    const pending = store.get(pluginDialogAtom);
    if (!pending) throw new Error("expected pending dialog");
    closePluginDialog(pending.requestId);
    finish({ view: { kind: "markdown", markdown: "Too late" } });
    await completion;

    expect(store.get(pluginDialogAtom)).toBeNull();
  });
});
