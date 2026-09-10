import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginView, PluginViewChannel, PluginViewUpdate, PluginDisposable } from "./plugin-types";
import { PluginViewSession } from "./plugin-view-session";
import { openPluginViewChannel, publishPluginView } from "./plugin-view-channels";
import { decodePluginCallbacks, PluginCallbackRegistry, retainPluginCallbacks } from "../runtime/plugin-callback-wire";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(subscribe?: (channel: PluginViewChannel) => PluginDisposable | Promise<PluginDisposable>) {
  const registry = new PluginCallbackRegistry(), owner = new AbortController();
  const channels: PluginViewChannel[] = [];
  let disposed = 0;
  const wire = <T,>(value: T): T => decodePluginCallbacks(structuredClone(registry.encode(value)),
    async (handle, args) => wire(await registry.invoke(handle, args)), handles => registry.release(handles), owner.signal) as T;
  const session = new PluginViewSession();
  const view = wire<PluginView>({ kind: "detail", title: "Initial", content: [], actions: [{ id: "run", label: "Run", run: () => ({ toast: "old" }) }],
    live: { subscribe: channel => {
      channels.push(channel);
      return subscribe ? subscribe(channel) : { dispose() { disposed++; } };
    } },
  });
  const publish = (channel: PluginViewChannel, update: PluginViewUpdate) => {
    const decoded = wire(update), release = retainPluginCallbacks(decoded);
    try { return publishPluginView(owner.signal, channel, decoded); } finally { release(); }
  };
  return { registry, owner, session, view, channels, wire, publish, disposed: () => disposed };
}

test("view channels are activation-scoped, revisioned, bounded and expire on release/retirement", () => {
  const a = new AbortController(), b = new AbortController(), applied: number[] = [];
  const held = Array.from({ length: 16 }, () => openPluginViewChannel(a.signal, update => applied.push(update.revision)));
  expect(() => openPluginViewChannel(a.signal, () => {})).toThrow();
  const update = { revision: 2, view: { kind: "markdown" as const, markdown: "Hello" } };
  expect(publishPluginView(b.signal, held[0].channel, update)).toEqual({ status: "inactive" });
  expect(publishPluginView(a.signal, held[0].channel, update)).toEqual({ status: "applied" });
  expect(publishPluginView(a.signal, held[0].channel, { ...update, revision: 1 })).toEqual({ status: "stale" });
  expect(publishPluginView(a.signal, held[0].channel, update)).toEqual({ status: "stale" });
  expect(() => publishPluginView(a.signal, held[0].channel, { ...update, revision: NaN })).toThrow();
  expect(applied).toEqual([2]);
  held[0].dispose(); held[0].dispose();
  const replacement = openPluginViewChannel(a.signal, () => {});
  expect(publishPluginView(a.signal, held[0].channel, update)).toEqual({ status: "inactive" });
  a.abort(); expect(publishPluginView(a.signal, replacement.channel, update)).toEqual({ status: "inactive" });
  expect(() => openPluginViewChannel(a.signal, () => {})).toThrow();
});

test("live snapshots preserve frame identity, keep painted callbacks until commit, and bound intermediate callbacks", async () => {
  const f = fixture(); f.session.setRoot(f.view); await flush();
  const key = f.session.getSnapshot().renderKey;
  const original = f.session.getSnapshot().stack[0]; f.session.acknowledgeRender(original);
  const initialSize = f.registry.size;
  for (let revision = 0; revision < 100; revision++) {
    expect(f.publish(f.channels[0], { revision, view: { kind: "detail", title: `Update ${revision}`, content: [], actions: [{ id: "new", label: "New", run: () => ({ toast: "new" }) }] } })).toEqual({ status: "applied" });
    expect(f.registry.size).toBeLessThanOrEqual(initialSize + 1);
  }
  expect(f.session.getSnapshot().renderKey).toBe(key);
  expect(f.session.getSnapshot().stack[0].title).toBe("Update 99");
  if (original.kind !== "detail") throw Error("Expected detail");
  expect(await original.actions![0].run()).toEqual({ toast: "old" });
  f.session.acknowledgeRender(f.session.getSnapshot().stack[0]);
  await expect(original.actions![0].run()).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(f.publish(f.channels[0], { revision: 99, view: { kind: "detail", content: [], actions: [{ id: "unused", label: "Unused", run: () => null }] } })).toEqual({ status: "stale" });
  f.session.dispose(); await flush(); expect(f.disposed()).toBe(1); expect(f.registry.size).toBe(0);
});

test("live content cannot replace the frame close callback and updates do not notify it", async () => {
  const f = fixture(), reasons: string[] = [];
  const view = { ...f.view, onClose: f.wire(({ reason }: { reason: string }) => { reasons.push(reason); }) };
  f.session.setRoot(view); await flush();
  expect(f.publish(f.channels[0], { revision: 1, view: { kind: "markdown", markdown: "New data" } })).toEqual({ status: "applied" });
  f.session.acknowledgeRender(f.session.getSnapshot().stack[0]); await flush(); expect(reasons).toEqual([]);
  expect(() => f.publish(f.channels[0], { revision: 2, view: { kind: "markdown", markdown: "bad", onClose: () => {} } as PluginView })).toThrow();
  f.session.close(); await flush(); expect(reasons).toEqual(["closed"]); expect(f.registry.size).toBe(0);
});

test("push/back and nested dialogs suspend sources and create fresh channels without accepting stale updates", async () => {
  const f = fixture(); f.session.setRoot(f.view); await flush();
  const first = f.channels[0];
  await f.session.run(() => ({ view: { kind: "markdown", markdown: "Child" } })); await flush();
  expect(f.disposed()).toBe(1);
  expect(f.publish(first, { revision: 100, view: { kind: "markdown", markdown: "Late" } })).toEqual({ status: "inactive" });
  f.session.back(); await flush(); expect(f.channels).toHaveLength(2); expect(f.channels[1]).not.toEqual(first);
  await f.session.run(() => ({ view: { kind: "markdown", markdown: "Dialog" } }), { presentation: "dialog" }); await flush();
  expect(f.disposed()).toBe(2);
  f.session.closeDialog(); await flush(); expect(f.channels).toHaveLength(3);
  f.session.dispose(); await flush(); expect(f.disposed()).toBe(3); expect(f.registry.size).toBe(0);
});

test("late subscription acknowledgements are disposed and cannot reopen a closed view", async () => {
  let finish!: (resource: PluginDisposable) => void;
  let cleanup = 0;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.session.setRoot(f.view); await flush(); const channel = f.channels[0]; f.session.close();
  expect(f.publish(channel, { revision: 1, view: { kind: "markdown", markdown: "Late" } })).toEqual({ status: "inactive" });
  finish({ dispose() { cleanup++; } }); await flush();
  expect(cleanup).toBe(1); expect(f.session.getSnapshot().stack).toEqual([]); expect(f.registry.size).toBe(0);
});

test("bad updates keep the last view, stop the subscription and allow an explicit retry", async () => {
  const f = fixture(); f.session.setRoot(f.view); await flush();
  expect(() => f.publish(f.channels[0], { revision: 1, view: { kind: "invalid", extra: () => null } as unknown as PluginView })).toThrow();
  await flush(); expect(f.session.getSnapshot().stack[0].title).toBe("Initial");
  expect(f.session.getSnapshot().liveError).toMatchObject({ code: "plugin/invalid-input", retryable: false }); expect(f.disposed()).toBe(1);
  f.session.retryLive(); await flush(); expect(f.channels).toHaveLength(2); expect(f.session.getSnapshot().liveError).toBeNull();
  expect(f.publish(f.channels[1], { revision: 1, view: { kind: "markdown", markdown: "Recovered" } })).toEqual({ status: "applied" });
  f.session.acknowledgeRender(f.session.getSnapshot().stack[0]);
  f.owner.abort(); await flush(); expect(f.session.getSnapshot().stack).toEqual([]); expect(f.registry.size).toBe(0);
});

test("subscription errors and invalid disposers surface as failures, not empty successful views", async () => {
  for (const subscribe of [() => Promise.reject(new AppError("fs/not-found", "private")), () => undefined as unknown as PluginDisposable]) {
    const f = fixture(subscribe); f.session.setRoot(f.view); await flush();
    expect(f.session.getSnapshot().stack[0].title).toBe("Initial");
    expect(f.session.getSnapshot().liveError).toBeInstanceOf(Error);
    f.session.dispose(); await flush(); expect(f.registry.size).toBe(0);
  }
});

test("live data arriving during an action does not discard that action's valid navigation", async () => {
  const f = fixture(); f.session.setRoot(f.view); await flush();
  let finish!: (result: { view: PluginView }) => void;
  const pending = f.session.run(() => new Promise(resolve => { finish = resolve; }));
  f.publish(f.channels[0], { revision: 1, view: { kind: "markdown", markdown: "Progress" } });
  expect(f.session.getSnapshot().busy).toBe(true);
  finish({ view: { kind: "markdown", markdown: "Destination" } }); await pending; await flush();
  expect(f.session.getSnapshot().stack).toHaveLength(2); expect(f.session.getSnapshot().busy).toBe(false);
  f.session.dispose(); await flush(); expect(f.registry.size).toBe(0);
});
