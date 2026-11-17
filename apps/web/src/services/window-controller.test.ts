import { expect, test } from "bun:test";
import {
  AppError,
  normalizeHostWindowRequest,
  type HostWindowObservation,
  type HostWindowRequest,
  type HostWindowState,
} from "@read-aware/core";
import { HostWindowService, type WindowAdapter } from "./window-controller";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { actorCause, causalActor, eventCause, stampEventCause } from "../platform/domain-actor";
import { hostWindow } from "./window";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const state: HostWindowState = { minimized: false, maximized: false, fullscreen: false, focused: true };
  const calls: HostWindowRequest[] = [],
    errors: unknown[] = [];
  const viewport = { width: 800, height: 600 };
  let changed = () => {},
    stops = 0;
  const adapter: WindowAdapter = {
    supported: () => true,
    read: async () => ({ ...state, viewport: { ...viewport } }),
    apply: async (request) => {
      calls.push(request);
      if (request.action === "fullscreen") state.fullscreen = request.enabled;
      else if (request.action === "minimize") state.minimized = true;
      else if (request.action === "maximize") {
        state.minimized = false;
        state.maximized = true;
        Object.assign(viewport, { width: 1200, height: 900 });
      } else {
        Object.assign(state, { minimized: false, maximized: false, fullscreen: false });
        Object.assign(viewport, { width: 800, height: 600 });
      }
    },
    watch: async (handler) => {
      changed = handler;
      return () => {
        stops++;
      };
    },
  };
  const service = new HostWindowService(adapter, (error) => errors.push(error));
  return {
    service,
    adapter,
    state,
    viewport,
    calls,
    errors,
    changed: () => changed(),
    get stops() {
      return stops;
    },
  };
}

test("public event-bound window requests retain source in receipts and exact sampled geometry", async () => {
  const f = fixture(),
    original = hostWindow.control;
  hostWindow.control = (request, signal, origin) => f.service.control(request, signal, origin);
  const runtime = buildPluginContext(
    { id: "window-cause", name: "Window", version: "1", schemaVersion: 1, requires: {} },
    "1",
    [],
  );
  runtime.lifecycle.promote();
  const rule = {};
  try {
    await runtime.reactions.deliver(rule, stampEventCause({}, causalActor("user")), async (reaction) => {
      const actor = runtime.reactions.actor(reaction);
      const receipt = await runtime.context.withEvent({ reaction }).services.ui.window!.control({ action: "maximize" });
      expect(eventCause(receipt.snapshot)).toBe(actorCause(actor));
      expect(receipt.snapshot).not.toHaveProperty("viewport");
      await runtime.reactions.deliver(rule, receipt.snapshot, (next) => {
        expect(next.status).toBe("cycle");
      });
    });
  } finally {
    hostWindow.control = original;
    runtime.lifecycle.stop();
    await runtime.lifecycle.drainCleanups();
  }
});

test("window intents are bounded, typed, ordered and return observed state rather than a paint claim", async () => {
  const f = fixture();
  for (const bad of [
    null,
    {},
    { action: "close" },
    { action: "fullscreen" },
    { action: "fullscreen", enabled: 1 },
    { action: "minimize", label: "other" },
    { action: "maximize", x: 0 },
  ]) {
    expect(() => normalizeHostWindowRequest(bad as HostWindowRequest)).toThrow();
  }
  const first = await f.service.snapshot();
  expect(await f.service.snapshot()).toEqual(first);
  const request: HostWindowRequest = { action: "fullscreen", enabled: true };
  const a = f.service.control(request),
    b = f.service.control({ action: "restore" });
  request.enabled = false;
  expect(await a).toMatchObject({ status: "requested", snapshot: { fullscreen: true } });
  expect(await b).toMatchObject({
    status: "requested",
    snapshot: { fullscreen: false, minimized: false, maximized: false },
  });
  expect(f.calls).toEqual([{ action: "fullscreen", enabled: true }, { action: "restore" }]);
  const copy = await f.service.snapshot();
  copy.revision = -1;
  expect((await f.service.snapshot()).revision).toBeGreaterThan(0);
});

test("queued cancellation prevents dispatch, native failures do not poison later intents, and pending requests are capped", async () => {
  const f = fixture(),
    held = Promise.withResolvers<void>();
  const apply = f.adapter.apply;
  f.adapter.apply = async (request) => {
    await held.promise;
    return apply(request);
  };
  const first = f.service.control({ action: "minimize" });
  const abort = new AbortController();
  const cancelled = f.service.control({ action: "maximize" }, abort.signal).catch((error) => error);
  abort.abort(new AppError("plugin/cancelled", "Retired"));
  const rest = Array.from({ length: 30 }, () => f.service.control({ action: "restore" }));
  await expect(f.service.control({ action: "maximize" })).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(await f.service.conditions({ action: "restore" })).toContainEqual({
    kind: "capacity",
    state: "unavailable",
    reason: "window-queue-full",
    errorCode: "ui/unavailable",
  });
  held.resolve();
  await first;
  await Promise.all(rest);
  expect(await cancelled).toMatchObject({ code: "plugin/cancelled" });
  expect(f.calls.some((request) => request.action === "maximize")).toBe(false);
  f.adapter.apply = async () => {
    throw new AppError("ipc/unknown", "OS refused");
  };
  await expect(f.service.control({ action: "maximize" })).rejects.toMatchObject({ code: "ipc/unknown" });
  f.adapter.apply = apply;
  expect(await f.service.control({ action: "maximize" })).toMatchObject({ snapshot: { maximized: true } });
});

test("observation coalesces slow callbacks, reports read failures and removes the last native watcher", async () => {
  const f = fixture(),
    values: HostWindowObservation[] = [],
    held = Promise.withResolvers<void>();
  const origin = causalActor("plugin:window-observer");
  const stop = f.service.observe(async (value) => {
    values.push(value);
    if (values.length === 1) await held.promise;
  }, origin);
  await tick();
  expect(eventCause(values[0]!)).toBe(actorCause(origin));
  f.state.maximized = true;
  for (let i = 0; i < 20; i++) f.changed();
  await tick();
  expect(values).toHaveLength(1);
  held.resolve();
  await tick();
  expect(values.at(-1)).toMatchObject({ status: "ready", snapshot: { maximized: true } });
  f.adapter.read = async () => {
    throw new AppError("ipc/unknown", "private native details");
  };
  f.changed();
  await tick();
  expect(values.at(-1)).toEqual({ status: "error", code: "ipc/unknown" });
  expect(eventCause(values.at(-1)!)).toBeDefined();
  f.adapter.read = async () => ({ ...f.state });
  f.changed();
  await tick();
  expect(values.at(-1)?.status).toBe("ready");
  stop();
  stop();
  expect(f.stops).toBe(1);
  const count = values.length;
  f.changed();
  await tick();
  expect(values).toHaveLength(count);
});

test("late watcher setup and late cancelled reads cannot retain listeners or publish a snapshot", async () => {
  const f = fixture(),
    watch = Promise.withResolvers<() => void>();
  let cleaned = 0,
    deliveries = 0;
  f.adapter.watch = () => watch.promise;
  const stop = f.service.observe(() => {
    deliveries++;
  });
  stop();
  watch.resolve(() => {
    cleaned++;
  });
  await tick();
  expect(cleaned).toBe(1);
  expect(deliveries).toBe(0);
  const read = Promise.withResolvers<HostWindowState>(),
    abort = new AbortController();
  f.adapter.read = () => read.promise;
  const pending = f.service.snapshot(abort.signal).catch((error) => error);
  await tick();
  abort.abort(new AppError("plugin/cancelled", "Retired"));
  read.resolve(f.state);
  expect(await pending).toMatchObject({ code: "plugin/cancelled" });
});

test("unsupported previews expose no guessed flags; plugin activation gates all operations and owns subscriptions", async () => {
  const plugin = buildPluginContext(
    { id: "window-test", name: "Window", version: "1", schemaVersion: 1, requires: {}, permissions: [] },
    "1",
    [],
  );
  const window = plugin.context.services.ui.window!;
  expect(() => window.control({ action: "maximize" })).toThrow();
  plugin.lifecycle.promote();
  expect(await window.snapshot()).toMatchObject({ supported: false });
  expect(
    await plugin.context.services.session.operationAvailability({
      operation: "window.control",
      request: { action: "maximize" },
    }),
  ).toMatchObject({ operation: "window.control", state: "unavailable", remoteChecked: false });
  await expect(window.control({ action: "maximize" })).rejects.toMatchObject({ code: "ui/unavailable" });
  let calls = 0;
  window.observe(() => {
    calls++;
  });
  await tick();
  expect(calls).toBe(1);
  plugin.lifecycle.stop();
  await plugin.lifecycle.drainCleanups();
  expect(() => window.snapshot()).toThrow();
  expect(() => window.control({ action: "restore" })).toThrow();
  expect(() =>
    plugin.context.services.session.operationAvailability({
      operation: "window.control",
      request: { action: "restore" },
    }),
  ).toThrow();
});

test("desktop window capabilities grant the bounded native operations only to main", async () => {
  const root = new URL("../../../desktop/src-tauri/", import.meta.url);
  const capability = await Bun.file(new URL("capabilities/desktop.json", root)).json();
  for (const name of [
    "minimize",
    "maximize",
    "unmaximize",
    "unminimize",
    "set-fullscreen",
    "is-minimized",
    "is-maximized",
    "is-fullscreen",
    "is-focused",
  ])
    expect(capability.permissions).toContain("core:window:allow-" + name);
  expect(capability.windows).toEqual(["main"]);
});

test("window prerequisites are read-only and reflect unsupported, unknown and target-state conditions", async () => {
  const f = fixture();
  expect(await f.service.conditions({ action: "restore" })).toContainEqual({
    kind: "input",
    state: "satisfied",
    reason: "window-already-in-requested-state",
  });
  expect(await f.service.conditions({ action: "maximize" })).toContainEqual({
    kind: "input",
    state: "satisfied",
    reason: "window-change-required",
  });
  expect(f.calls).toHaveLength(0);
  f.adapter.read = async () => {
    throw Error("private native failure");
  };
  expect(await f.service.conditions({ action: "maximize" })).toContainEqual({
    kind: "object",
    state: "unknown",
    reason: "window-state-read-failed",
    errorCode: "ui/unavailable",
  });
  f.adapter.supported = () => false;
  expect(await f.service.conditions({ action: "maximize" })).toContainEqual({
    kind: "provider",
    state: "unavailable",
    reason: "desktop-window-unsupported",
    errorCode: "ui/unavailable",
  });
  await expect(f.service.control({ action: "maximize" })).rejects.toMatchObject({ code: "ui/unavailable" });
  const aborted = new AbortController();
  aborted.abort();
  await expect(f.service.conditions({ action: "restore" }, aborted.signal)).rejects.toBeDefined();
  expect(f.calls).toHaveLength(0);
});
