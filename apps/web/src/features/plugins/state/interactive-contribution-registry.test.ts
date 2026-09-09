import { expect, test } from "bun:test";
import type { PluginActionState } from "../lib/plugin-types";
import { actionEnabled, actionVisible } from "../lib/plugin-action-state";
import { decodePluginCallbacks, PluginCallbackRegistry, pluginCallbackOwner } from "../runtime/plugin-callback-wire";
import { createInteractiveContributionRegistry } from "./interactive-contribution-registry";

type Action = { key: string; pluginId: string; state?: PluginActionState; run(): unknown };
const state = (revision: number, enabled = true, visible = true, checked?: boolean): PluginActionState =>
  ({ revision, enabled, visible, ...(checked === undefined ? {} : { checked }) });
const fixture = () => createInteractiveContributionRegistry<Action>("commands", "run", { catalog: false });

test("action states are validated immutable snapshots and all new executions recheck availability", async () => {
  const registry = fixture();
  let calls = 0;
  const registration = registry.register({ key: "probe:one", pluginId: "probe", run: () => ++calls });
  const initial = registry.list()[0];
  expect(initial.state).toEqual(state(0));
  expect(initial.run()).toBe(1);
  const update = state(3, false, true, true);
  expect(await registration.updateState(update)).toEqual({ status: "applied" });
  update.enabled = true;
  expect(registry.list()[0].state).toEqual(state(3, false, true, true));
  expect(initial.state).toEqual(state(0));
  expect(registry.list()[0].run).toBe(initial.run);
  expect(actionVisible(registry.list()[0])).toBe(true);
  expect(actionEnabled(registry.list()[0])).toBe(false);
  expect(initial.run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
  expect(await registration.updateState(state(3))).toEqual({ status: "stale" });
  expect(await registration.updateState(state(2))).toEqual({ status: "stale" });
  expect(await registration.updateState(state(4, true, false))).toEqual({ status: "applied" });
  expect(actionEnabled(registry.list()[0])).toBe(false);
  expect(initial.run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
  await registration.updateState(state(5));
  expect(registry.list()[0].state?.checked).toBeUndefined();
  expect(initial.run()).toBe(2);
  registration.dispose();
  expect(await registration.updateState(state(6))).toEqual({ status: "inactive" });
  expect(initial.run).toThrow(expect.objectContaining({ code: "plugin/unavailable" }));
});

test("malformed initial and updated states do not replace a valid registration or state", async () => {
  const registry = fixture();
  const item = { key: "probe:one", pluginId: "probe", run: () => null };
  const registration = registry.register(item);
  const original = registry.list()[0];
  for (const invalid of [null, {}, -1, { ...state(1), revision: NaN }, { ...state(1), revision: 1.5 },
    { ...state(1), revision: -1 }, { ...state(1), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...state(1), enabled: "yes" }, { ...state(1), visible: 0 }, { ...state(1), checked: null }]) {
    expect(() => registry.register({ ...item, state: invalid as PluginActionState }))
      .toThrow(expect.objectContaining({ code: "plugin/invalid-input" }));
    await expect(registration.updateState(invalid as PluginActionState)).rejects.toMatchObject({ code: "plugin/invalid-input" });
    expect(registry.list()[0]).toBe(original);
  }
  await expect(registration.updateState(undefined as unknown as PluginActionState)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  registration.dispose();
});

test("replacement and activation retirement invalidate exact handles, not matching public IDs", async () => {
  const registry = fixture();
  const owner = new AbortController();
  const wire = new PluginCallbackRegistry();
  const callback = decodePluginCallbacks(wire.encode(() => "old"), (handle, args) => wire.invoke(handle, args), undefined, owner.signal) as Action["run"];
  const old = registry.register({ key: "probe:one", pluginId: "probe", run: callback });
  const cached = registry.list()[0].run;
  expect(pluginCallbackOwner(cached)).toBe(owner.signal);
  const next = registry.register({ key: "probe:one", pluginId: "probe", run: callback });
  expect(await old.updateState(state(100, false))).toEqual({ status: "inactive" });
  expect(cached).toThrow(expect.objectContaining({ code: "plugin/unavailable" }));
  old.dispose();
  expect(registry.list()[0].run()).toBe("old");
  owner.abort();
  expect(registry.list()[0].run).toThrow(expect.objectContaining({ code: "plugin/unavailable" }));
  expect(await next.updateState(state(1))).toEqual({ status: "inactive" });
  next.dispose();
  expect(registry.list()).toEqual([]);
});

test("disabling does not cancel an operation that already began", async () => {
  const registry = fixture();
  const completion = Promise.withResolvers<string>();
  const registration = registry.register({ key: "probe:one", pluginId: "probe", run: () => completion.promise });
  const pending = registry.list()[0].run();
  await registration.updateState(state(1, false));
  completion.resolve("committed");
  expect(await pending).toBe("committed");
  expect(registry.list()[0].run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
  registration.dispose();
});
