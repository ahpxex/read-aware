import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { windowView } from "../src/window";

type WindowService = NonNullable<PluginContext["services"]["ui"]["window"]>;
type Snapshot = Awaited<ReturnType<WindowService["snapshot"]>>;
type Observation = Parameters<Parameters<WindowService["observe"]>[0]>[0];
function fixture(locale = "en") {
  let snapshot: Snapshot = { supported: true, revision: 1, minimized: false, maximized: false, fullscreen: false, focused: true };
  let observer!: (value: Observation) => unknown;
  let disposed = 0, reads = 0, failure: Error | undefined;
  const requests: Parameters<WindowService["control"]>[0][] = [];
  const published: { revision: number; view: PluginDetailView }[] = [];
  const ctx = { locale, services: {
    storage: { collection: () => ({ page: async () => ({ status: "ready", items: [], nextCursor: null }) }) },
    ui: { window: {
      snapshot: async () => { reads++; if (failure) throw failure; return snapshot; },
      observe: (handler: typeof observer) => { observer = handler; return { dispose() { disposed++; } }; },
      control: async (request: typeof requests[number]) => { if (failure) throw failure; requests.push(request); return { status: "requested", snapshot }; },
    }, publishView: async (_channel: unknown, frame: typeof published[number]) => { published.push(frame); } },
  } } as unknown as PluginContext;
  return { ctx, requests, published, set: (value: Snapshot) => { snapshot = value; },
    fail: () => { failure = Object.assign(Error("private OS error"), { code: "ui/unavailable" }); },
    emit: async (value: Observation) => { await observer(value); },
    counts: () => ({ disposed, reads }),
  };
}
const action = async (view: PluginDetailView | PluginListView, id: string) => (await view.actions!.find(item => item.id === id)!.run())!;
const state = (fullscreen = false): Snapshot => ({ supported: true, revision: 2, minimized: false, maximized: true, fullscreen, focused: false });

test("opening reads window metadata without changing window or saved profiles", async () => {
  const f = fixture(), view = await windowView(f.ctx);
  expect(view.content).toEqual([{ kind: "keyValue", rows: [
    { label: "Minimized", value: "No" }, { label: "Maximized", value: "No" },
    { label: "Full screen", value: "No" }, { label: "Focused", value: "Yes" },
  ] }]);
  expect(f.requests).toEqual([]);
  expect(view.actions!.map(item => item.id)).toEqual(["minimize", "maximize", "restore", "enter-fullscreen", "refresh"]);
});

test("all window intents use the public service and report requested rather than animation completion", async () => {
  const f = fixture(), view = await windowView(f.ctx);
  for (const id of ["minimize", "maximize", "restore", "enter-fullscreen"]) {
    expect(await action(view, id)).toEqual({ toast: "Window change requested" });
  }
  f.set(state(true)); const full = await windowView(f.ctx);
  await action(full, "exit-fullscreen");
  expect(f.requests).toEqual([{ action: "minimize" }, { action: "maximize" }, { action: "restore" },
    { action: "fullscreen", enabled: true }, { action: "fullscreen", enabled: false }]);
  expect(f.counts().reads).toBe(2);
});

test("live snapshots update controls; old full-screen actions retain their explicit intent", async () => {
  const f = fixture(), view = await windowView(f.ctx);
  const subscription = await view.live!.subscribe({ id: "window", generation: 1 } as never);
  await f.emit({ status: "ready", snapshot: state(true) });
  expect(f.published[0]!.view.actions!.map(item => item.id)).toContain("exit-fullscreen");
  await action(view, "enter-fullscreen");
  expect(f.requests[0]).toEqual({ action: "fullscreen", enabled: true });
  expect(f.published).toHaveLength(1);
  subscription.dispose(); subscription.dispose();
  await f.emit({ status: "ready", snapshot: state(false) });
  expect(f.counts().disposed).toBe(1); expect(f.published).toHaveLength(1);
});

test("observation failures hide stale controls and recover with a fresh native snapshot", async () => {
  const f = fixture(), view = await windowView(f.ctx);
  const subscription = await view.live!.subscribe({ id: "window", generation: 1 } as never);
  await f.emit({ status: "error", code: "ui/unavailable" });
  expect(f.published[0]!.view.content).toEqual([{ kind: "error", code: "ui/unavailable" }]);
  expect(f.published[0]!.view.actions!.map(item => item.id)).toEqual(["refresh"]);
  await f.emit({ status: "ready", snapshot: state(true) });
  expect(f.published[1]!.view.actions!.map(item => item.id)).toContain("exit-fullscreen");
  expect(f.published.map(frame => frame.revision)).toEqual([1, 2]);
  subscription.dispose();
});

test("unsupported windows have no commands and explicit refresh replaces the frame", async () => {
  const f = fixture(); f.set({ supported: false, revision: 3 });
  const view = await windowView(f.ctx);
  expect(view.content).toEqual([{ kind: "text", text: "Window controls unavailable" }]);
  expect(view.actions!.map(item => item.id)).toEqual(["refresh"]);
  f.set(state()); const refreshed = await action(view, "refresh");
  expect(refreshed.navigation).toBe("replace");
  expect((refreshed.view as PluginDetailView).actions!.map(item => item.id)).toContain("maximize");
  expect(f.requests).toHaveLength(0);
});

test("missing service and failed native operations surface stable errors without success", async () => {
  const f = fixture(), view = await windowView(f.ctx); f.fail();
  await expect(action(view, "maximize")).rejects.toMatchObject({ code: "ui/unavailable" });
  await expect(windowView(f.ctx)).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(f.requests).toHaveLength(0);
  delete f.ctx.services.ui.window;
  await expect(windowView(f.ctx)).rejects.toMatchObject({ code: "ui/unavailable" });
});

test("Chinese window labels and command receipt are localized", async () => {
  const f = fixture("zh-Hans");
  const view = await windowView(f.ctx);
  expect(view.title).toBe("窗口");
  expect(await action(view, "restore")).toEqual({ toast: "已请求窗口变更" });
});

test("compiled header and command both expose window controls without new host APIs or permission", async () => {
  const f = fixture(); let run!: () => Promise<PluginViewResult>, open!: () => Promise<PluginListView>;
  Object.assign(f.ctx, { contributions: {
    commands: { register: (value: { run: typeof run }) => { run = value.run; return { dispose() {} }; } },
    headerActions: { register: (value: { view: typeof open }) => { open = value.view; return { dispose() {} }; } },
    agentTools: { register: () => ({ dispose() {} }) },
  } });
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  for (const root of [(await run())!.view as PluginListView, await open()]) {
    const window = (await action(root, "window")).view as PluginDetailView;
    await action(window, "maximize");
  }
  expect(f.requests).toEqual([{ action: "maximize" }, { action: "maximize" }]);
  const manifest = await Bun.file(new URL("../dist/manifest.json", import.meta.url)).json();
  expect(manifest.version).toBe("0.6.0");
  expect(manifest.requires.services.ui).toBe("^1.11.0");
  expect(manifest.permissions).toEqual(["agent:tools"]);
});
