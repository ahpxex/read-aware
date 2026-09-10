import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { AppError } from "@read-aware/core";
import { createSettingsDomain } from "./domain";
import * as persistence from "./persistence";
import { DEFAULT_READER_PREFERENCES } from "../../features/settings/lib/reader-settings";
import { readerOverridesAtom, readerPreferencesAtom } from "../../state/ui";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
} });
const store = getDefaultStore(), cleanups: Array<() => void> = [];
beforeEach(() => {
  store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES, fontSize: "large" });
  store.set(readerOverridesAtom, {
    active: { scope: "book", settings: { ...DEFAULT_READER_PREFERENCES, fontSize: "xx-large" } },
    dormant: { scope: "global", settings: { ...DEFAULT_READER_PREFERENCES, fontSize: "x-large" } },
  });
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

test("reading provenance reports active and remembered overrides without leaking it through discovery", async () => {
  const domain = createSettingsDomain("agent");
  for (const [bookId, source, override, value] of [
    ["active", "book", "active", "xx-large"], ["dormant", "global", "inactive", "large"], ["missing", "global", "absent", "large"],
  ] as const) {
    expect(await domain.queries.read("reading.fontSize", { kind: "book", bookId })).toMatchObject({
      value, reading: { source, override, defaultValue: DEFAULT_READER_PREFERENCES.fontSize },
    });
  }
  const restricted = createSettingsDomain("plugin:discover", { discover: ["reading.fontSize"] });
  const catalog = await restricted.queries.discover({ target: { kind: "book", bookId: "active" } });
  expect(catalog[0]).not.toHaveProperty("reading");
  expect(catalog[0]).not.toHaveProperty("value");
});

test("inherit deletes the whole saved override and follows subsequent global changes", async () => {
  const domain = createSettingsDomain("plugin:reader", { write: ["reading.*"] });
  const events: unknown[] = []; cleanups.push(domain.events.subscribe(event => events.push(event)));
  const reset = await domain.commands.resetReading({ action: "inherit", target: { kind: "book", bookId: "active" } });
  expect(store.get(readerOverridesAtom).active).toBeUndefined();
  expect(reset.settings.settings.find(entry => entry.path === "reading.fontSize")).toMatchObject({
    value: "large", reading: { source: "global", override: "absent" },
  });
  expect(events[0]).toMatchObject({ origin: "plugin:reader" });
  await domain.commands.update([{ path: "reading.fontSize", target: { kind: "global" }, value: "xxx-large" }]);
  expect((await domain.queries.read("reading.fontSize", { kind: "book", bookId: "active" })).value).toBe("xxx-large");
  await domain.commands.resetReading({ action: "inherit", target: { kind: "book", bookId: "dormant" } });
  expect(store.get(readerOverridesAtom)).toEqual({});
});

test("defaults and inheritance preserve their distinct global, book and all-books meanings", async () => {
  const domain = createSettingsDomain("agent");
  await domain.commands.resetReading({ action: "defaults", target: { kind: "global" } });
  expect(store.get(readerOverridesAtom).active?.settings.fontSize).toBe("xx-large");
  await domain.commands.resetReading({ action: "defaults", target: { kind: "book", bookId: "active" } });
  expect(store.get(readerOverridesAtom).active).toEqual({ scope: "book", settings: DEFAULT_READER_PREFERENCES });
  await domain.commands.update([{ path: "reading.fontSize", target: { kind: "global" }, value: "small" }]);
  await domain.commands.resetReading({ action: "inherit", target: { kind: "all-books" } });
  expect(store.get(readerPreferencesAtom).fontSize).toBe("small");
  expect(store.get(readerOverridesAtom)).toEqual({});
  await domain.commands.resetReading({ action: "defaults", target: { kind: "all-books" } });
  expect(store.get(readerPreferencesAtom)).toEqual(DEFAULT_READER_PREFERENCES);
  expect((await domain.commands.resetReading({ action: "defaults", target: { kind: "all-books" } })).changed).toEqual([]);
});

test("partial grants, invalid input, cancellation and failed persistence cannot reset live state", async () => {
  const domain = createSettingsDomain("agent"), partial = createSettingsDomain("plugin:font", { write: ["reading.fontSize"] });
  const request = { action: "inherit" as const, target: { kind: "all-books" as const } };
  await expect(partial.commands.resetReading(request)).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(domain.commands.resetReading({ action: "inherit", target: { kind: "global" } } as never)).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(domain.commands.resetReading(request, AbortSignal.abort())).rejects.toBeDefined();
  const commit = spyOn(persistence, "commitSettingsDraft").mockRejectedValue(new AppError("db/locked", "private failure"));
  cleanups.push(() => commit.mockRestore());
  await expect(domain.commands.resetReading(request)).rejects.toMatchObject({ code: "db/locked" });
  expect(store.get(readerOverridesAtom).active?.settings.fontSize).toBe("xx-large");
});
