import { expect, test } from "bun:test";
import { AppError, type SettingsObservation, type SettingsSnapshot } from "@read-aware/core";
import { SettingsObservationHub } from "./observation";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const snapshot = (value = "light", revision = 0): SettingsSnapshot => ({ revision, target: { kind: "global" }, overrides: [],
  settings: [{ path: "appearance.theme", section: "appearance", kind: "enum", writable: true, label: "Theme", value }] });

test("settings observation coalesces causes, suppresses invisible changes and serializes callbacks", async () => {
  const hub = new SettingsObservationHub(() => {}), seen: SettingsObservation[] = [];
  let value = "light", release!: () => void;
  const stop = hub.observe(async () => snapshot(value, hub.revision), async state => {
    seen.push(state); if (seen.length === 1) await new Promise<void>(resolve => { release = resolve; });
  });
  await tick(); expect(seen[0]).toMatchObject({ source: "initial", origin: null });
  value = "dark";
  hub.invalidate({ source: "local", origin: "agent" });
  hub.invalidate({ source: "remote", origin: null });
  expect(seen).toHaveLength(1); release(); await tick();
  expect(seen[1]).toMatchObject({ status: "ready", source: "mixed", origin: null, snapshot: { revision: 2 } });
  hub.invalidate({ source: "local", origin: "plugin:hidden" }); await tick();
  expect(seen).toHaveLength(2);
  stop(); value = "system"; hub.invalidate({ source: "catalog", origin: null }); await tick();
  expect(seen).toHaveLength(2);
});

test("a commit during a held read is retried rather than attributed to the wrong actor", async () => {
  const hub = new SettingsObservationHub(() => {}), seen: SettingsObservation[] = [];
  let release!: (value: SettingsSnapshot) => void, reads = 0;
  const stop = hub.observe(() => ++reads === 2 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(snapshot(String(reads), hub.revision)), state => { seen.push(state); });
  await tick(); hub.invalidate({ source: "local", origin: "agent" }); await tick();
  hub.invalidate({ source: "local", origin: "plugin:next" }); release(snapshot("outdated", 1)); await tick();
  expect(seen).toHaveLength(2); expect(reads).toBe(3);
  expect(seen[1]).toMatchObject({ source: "local", origin: null, snapshot: { revision: 2 } }); stop();
});

test("read errors retain stable codes, recovery publishes and callback failure does not poison delivery", async () => {
  const errors: unknown[] = [], seen: SettingsObservation[] = [];
  const hub = new SettingsObservationHub(error => errors.push(error)); let fail = true;
  const stop = hub.observe(async () => { if (fail) throw new AppError("db/locked", "private failure"); return snapshot(); }, state => { seen.push(state); if (seen.length === 1) throw Error("handler failed"); });
  await tick(); expect(seen[0]).toMatchObject({ status: "error", code: "db/locked" });
  expect(JSON.stringify(seen)).not.toContain("private failure");
  fail = false; hub.invalidate({ source: "restore", origin: null }); await tick();
  expect(seen[1]).toMatchObject({ status: "ready", source: "restore" }); expect(errors).toHaveLength(2); stop();
});

test("observers are bounded and disposal suppresses in-flight reads", async () => {
  const hub = new SettingsObservationHub(() => {}), stops: (() => void)[] = [];
  let release!: (value: SettingsSnapshot) => void, calls = 0;
  stops.push(hub.observe(() => new Promise(resolve => { release = resolve; }), () => { calls++; }));
  for (let i = 1; i < 64; i++) stops.push(hub.observe(async () => snapshot(), () => {}));
  expect(() => hub.observe(async () => snapshot(), () => {})).toThrow("Too many settings observers");
  for (const stop of stops) { stop(); stop(); }
  release(snapshot()); await tick(); expect(calls).toBe(0);
  const stop = hub.observe(async () => snapshot(), () => { calls++; }); await tick(); expect(calls).toBe(1); stop();
});
