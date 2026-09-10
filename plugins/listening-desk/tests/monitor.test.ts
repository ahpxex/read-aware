import { expect, mock, test } from "bun:test";
import type { PluginCommand, PluginContext, PluginModule, PluginView, PluginViewResult, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { readingMonitor } from "../src/monitor";
import { panelWidths } from "../src/panel-widths";

type Reader = NonNullable<PluginContext["services"]["ui"]["reader"]>;
type Panels = NonNullable<Awaited<ReturnType<Reader["snapshot"]>>>;
type Environment = Awaited<ReturnType<PluginContext["services"]["session"]["environment"]>>;
function view(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("Expected a view");
  return result.view;
}
function action(current: PluginView, id: string) {
  const actions = current.kind === "blocks" ? current.blocks.find(block => block.kind === "actions")?.actions
    : "actions" in current ? current.actions : undefined;
  const found = actions?.find(item => item.id === id);
  if (!found) throw Error(`Missing action: ${id}`);
  return found;
}
function fixture() {
  const state: ReadingSessionSnapshot = { revision: 1, sessionId: "s1", bookId: "b1", status: "ready", location: null,
    visibleText: "private passage", selection: null, controls: null, pagination: null, history: { canGoBack: false, canGoForward: false },
    mode: { status: "inactive", unavailableReason: null, requestedActive: false, modeKey: "mode", availableModes: [],
      label: "Mode", unitId: "sentence", units: [], progress: { ordinal: 1, total: 4 }, cfiRange: null, position: null },
    playback: { status: "stopped", unavailableReason: null, backend: null, fallback: false, owner: null, cfiRange: null } };
  const panels: Panels = { sessionId: "s1", bookId: "b1", revision: 1, controlsVisible: true, sizes: { toc: 288, chat: 352 }, layout: "docked",
    panels: { toc: { open: true, visible: true }, chat: { open: true, visible: false }, annotations: { open: false, visible: false }, appearance: { open: false, visible: false } } };
  const environment: Environment = { revision: 1, runtime: "desktop", platform: "macos", locale: "en", timeZone: "UTC", utcOffsetMinutes: 0, networkHint: "online" };
  let sessionHandler!: (value: ReadingSessionSnapshot) => unknown, panelHandler!: (value: Panels | null) => unknown, environmentHandler!: (value: Environment) => unknown;
  const disposeSession = mock(() => {}), disposePanel = mock(() => {}), disposeEnvironment = mock(() => {});
  const commands: PluginCommand[] = [];
  const snapshot = mock(async (): Promise<Panels | null> => panels);
  const setWidth = mock(async (panel: "toc" | "chat", width: number, _guard?: unknown) => ({ status: "completed" as const, panel,
    snapshot: { ...panels, sizes: { ...panels.sizes, [panel]: width } } }));
  const controlPlayback = mock(async (_action: "start" | "stop", _guard: unknown, _options?: unknown) => ({ status: "completed", sessionId: "s1", playback: state.playback }));
  const publishView = mock(async (_channel: unknown, _update: { revision: number; view: PluginView }) => ({ status: "applied" }));
  const ctx = { locale: "en", contributions: { commands: { register: (command: PluginCommand) => commands.push(command) }, headerActions: { register: mock() } },
    domains: { reading: { queries: { session: mock(async () => state) }, commands: { controlPlayback },
      events: { observeSession: (handler: typeof sessionHandler) => { sessionHandler = handler; return { dispose: disposeSession }; } } } },
    services: { ui: { publishView, reader: { snapshot, setWidth, observe: (handler: typeof panelHandler) => { panelHandler = handler; return { dispose: disposePanel }; } } },
      session: { environment: mock(async () => environment), observeEnvironment: (handler: typeof environmentHandler) => { environmentHandler = handler; return { dispose: disposeEnvironment }; } },
      logging: { write: mock(async () => {}) } },
  } as unknown as PluginContext;
  return { ctx, state, panels, environment, snapshot, setWidth, controlPlayback, publishView, commands, disposeSession, disposePanel, disposeEnvironment,
    sessionChanged: (value: ReadingSessionSnapshot) => sessionHandler(value), panelsChanged: (value: Panels | null) => panelHandler(value),
    environmentChanged: (value: Environment) => environmentHandler(value) };
}

test("monitor composes three live streams, truthful progress and guarded playback without exposing passage text", async () => {
  const f = fixture(), lifetime = new AbortController();
  const current = await readingMonitor(f.ctx, lifetime.signal);
  expect(JSON.stringify(current)).not.toContain("private passage");
  expect(JSON.stringify(current)).toContain("2 / 4");
  const start = action(current, "start");
  const subscription = await current.live!.subscribe({ id: "monitor" });
  await f.sessionChanged({ ...f.state, sessionId: "s2", playback: { ...f.state.playback, status: "preparing", backend: "system", fallback: true } });
  const update = f.publishView.mock.calls[0]![1].view;
  expect(JSON.stringify(update)).toContain('"value":null');
  expect(JSON.stringify(update)).toContain("System fallback");
  expect(JSON.stringify(update)).not.toContain("Docked");
  expect("actions" in update && update.actions?.some(item => item.id === "widths")).toBe(false);
  await start.run();
  expect(f.controlPlayback).toHaveBeenCalledWith("start", { sessionId: "s1", bookId: "b1" }, { signal: lifetime.signal });
  await action(update, "stop").run();
  expect(f.controlPlayback).toHaveBeenLastCalledWith("stop", { sessionId: "s2", bookId: "b1" }, { signal: lifetime.signal });
  await f.environmentChanged({ ...f.environment, networkHint: "offline" });
  await f.panelsChanged({ ...f.panels, sessionId: "s2", layout: "exclusive" });
  const last = f.publishView.mock.calls[f.publishView.mock.calls.length - 1]![1].view;
  expect(JSON.stringify(last)).toContain("Offline");
  expect(JSON.stringify(last)).toContain("Exclusive");
  subscription.dispose();
  await f.sessionChanged(f.state);
  expect(f.publishView).toHaveBeenCalledTimes(3);
  expect(f.disposeSession).toHaveBeenCalledTimes(1);
  expect(f.disposePanel).toHaveBeenCalledTimes(1);
  expect(f.disposeEnvironment).toHaveBeenCalledTimes(1);
});

test("a failed subscription releases already-installed observers; initial read errors stay errors", async () => {
  const f = fixture(), lifetime = new AbortController();
  const current = await readingMonitor(f.ctx, lifetime.signal);
  f.ctx.services.session.observeEnvironment = () => { throw { code: "ui/observer-limit" }; };
  expect(() => current.live!.subscribe({ id: "failure" })).toThrow();
  expect(f.disposeSession).toHaveBeenCalledTimes(1);
  await f.sessionChanged(f.state);
  expect(f.publishView).not.toHaveBeenCalled();
  f.snapshot.mockRejectedValueOnce({ code: "reader/unavailable" });
  await expect(readingMonitor(f.ctx, lifetime.signal)).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("width form validates bounds, freezes its target and reports the write receipt without a second read", async () => {
  const f = fixture(), lifetime = new AbortController();
  const widths = await panelWidths(f.ctx, lifetime.signal);
  if (widths.kind !== "list") throw Error("Expected a list");
  const form = view(await widths.items[1]!.onSelect!());
  if (form.kind !== "form") throw Error("Expected a form");
  expect(form.fields[0]).toMatchObject({ kind: "number", min: 240, max: 640, step: 1, value: 352 });
  for (const width of [239, 641, 300.5, "320"]) expect(await form.onSubmit({ width })).toHaveProperty("fieldErrors.width");
  expect(f.setWidth).not.toHaveBeenCalled();
  f.state.sessionId = "s2";
  f.snapshot.mockRejectedValueOnce({ code: "reader/unavailable" });
  const result = view(await form.onSubmit({ width: 400 }));
  expect(f.setWidth).toHaveBeenCalledWith("chat", 400, { sessionId: "s1", bookId: "b1" });
  expect(JSON.stringify(result)).toContain("400 px");
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  f.setWidth.mockRejectedValueOnce({ code: "db/locked" });
  await expect(form.onSubmit({ width: 420 })).rejects.toMatchObject({ code: "db/locked" });
  lifetime.abort();
  await expect(form.onSubmit({ width: 420 })).rejects.toThrow();
});

test("width editing rejects mismatched sessions and does not offer writes without setWidth", async () => {
  const f = fixture(), lifetime = new AbortController();
  f.panels.sessionId = "stale";
  await expect(panelWidths(f.ctx, lifetime.signal)).rejects.toMatchObject({ code: "reader/unavailable" });
  f.panels.sessionId = "s1";
  f.ctx.services.ui.reader!.setWidth = undefined;
  const widths = await panelWidths(f.ctx, lifetime.signal);
  if (widths.kind !== "list") throw Error("Expected a list");
  expect(widths.items.every(item => !item.onSelect)).toBe(true);
});

test("compiled entry exposes live status and width controls; deactivation releases all subscriptions", async () => {
  const f = fixture();
  const built = (await import(new URL("../dist/main.js", import.meta.url).href) as { default: PluginModule }).default;
  try {
    await built.activate(f.ctx);
    const home = view(await f.commands.find(command => command.id === "open")!.run());
    expect(action(home, "widths")).toBeDefined();
    const monitor = view(await action(home, "monitor").run());
    await monitor.live!.subscribe({ id: "compiled" });
    await built.deactivate?.();
    expect(f.disposeSession).toHaveBeenCalledTimes(1);
    expect(f.disposePanel).toHaveBeenCalledTimes(1);
    expect(f.disposeEnvironment).toHaveBeenCalledTimes(1);
    await f.sessionChanged(f.state);
    expect(f.publishView).not.toHaveBeenCalled();
  } finally { await built.deactivate?.(); }
});
