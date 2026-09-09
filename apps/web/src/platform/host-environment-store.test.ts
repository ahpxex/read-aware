import { expect, test } from "bun:test";
import type { HostEnvironmentSnapshot } from "@read-aware/core";
import { HostEnvironmentStore } from "./host-environment-store";

function fixture() {
  let facts: Omit<HostEnvironmentSnapshot, "revision"> = { runtime: "desktop", platform: "macos", locale: "en", timeZone: "UTC", utcOffsetMinutes: 0, networkHint: "online" };
  let changed: (() => void) | undefined;
  let watches = 0, releases = 0;
  const errors: unknown[] = [];
  const store = new HostEnvironmentStore({ read: () => facts, watch: fn => { changed = fn; watches++; return () => { releases++; changed = undefined; }; }, report: e => { errors.push(e); } });
  return { store, errors, counts: () => ({ watches, releases }), change: (patch: Partial<typeof facts>, notify = true) => { facts = { ...facts, ...patch }; if (notify) changed?.(); } };
}

test("queries and initial observations share current revisions without a lost read/subscribe window", () => {
  const f = fixture(); const first = f.store.snapshot();
  f.change({ locale: "ja" }, false);
  const seen: HostEnvironmentSnapshot[] = [];
  const off = f.store.observe(s => { seen.push(s); });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ revision: first.revision + 1, locale: "ja" });
  f.change({ locale: "ja" }); expect(seen).toHaveLength(1);
  f.change({ networkHint: "offline" }); expect(seen.at(-1)?.networkHint).toBe("offline");
  f.change({ timeZone: "Europe/Paris", utcOffsetMinutes: 120 }, false);
  expect(f.store.snapshot()).toMatchObject({ timeZone: "Europe/Paris", utcOffsetMinutes: 120 });
  expect(seen).toHaveLength(3); off();
});

test("observer mutation and rejection cannot corrupt other actors or retain the shared watcher", async () => {
  const f = fixture();
  const offBad = f.store.observe(async state => { state.locale = "mutated"; throw Error("observer rejected"); });
  const seen: string[] = [];
  const offGood = f.store.observe(state => { seen.push(state.locale); });
  expect(f.counts()).toEqual({ watches: 1, releases: 0 });
  expect(f.store.snapshot().locale).toBe("en"); expect(seen).toEqual(["en"]);
  await Promise.resolve(); expect(f.errors).toHaveLength(1);
  offBad(); offBad(); expect(f.counts().releases).toBe(0);
  offGood(); expect(f.counts().releases).toBe(1);
  f.change({ locale: "de" }); expect(seen).toEqual(["en"]);
  const off = f.store.observe(state => { seen.push(state.locale); });
  expect(seen).toEqual(["en", "de"]); off();
  expect(f.counts()).toEqual({ watches: 2, releases: 2 });
});

test("reentrant refreshes never send a later observer a stale revision", () => {
  const f = fixture();
  const offFirst = f.store.observe(state => {
    if (state.locale === "ja") f.change({ locale: "de" });
  });
  const revisions: number[] = [], locales: string[] = [];
  const offSecond = f.store.observe(state => { revisions.push(state.revision); locales.push(state.locale); });
  f.change({ locale: "ja" });
  expect(revisions).toEqual([1, 3]);
  expect(locales).toEqual(["en", "de"]);
  expect(f.store.snapshot().revision).toBe(3);
  offFirst(); offSecond();
});
