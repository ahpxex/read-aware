import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginModule, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { refreshScheduleView } from "../src/schedule-view";
import { scheduleCopy } from "../src/schedule-strings";
import type { RssPluginContext } from "../src/types";
import manifest from "../manifest.json";

type Page = Awaited<ReturnType<PluginContext["services"]["schedules"]["list"]>>;
function fixture() {
  const initial: Page["schedules"][number] = { pluginId: "rss-reader", id: "refresh-feeds", label: "Refresh feeds", everyMinutes: 60,
    paused: false, running: false, lastOutcome: null, lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastErrorCode: null };
  const state = { schedule: initial, missing: false, fail: false, alreadyRunning: false };
  const page = (): Page => ({ schedules: state.missing ? [] : [structuredClone(state.schedule)], total: state.missing ? 0 : 1, nextOffset: null });
  const controls: unknown[] = [], published: PluginView[] = [];
  let handler!: (page: Page) => Promise<void>, disposed = 0;
  const ctx = { locale: "en", services: { schedules: {
    list: async (query: unknown) => { expect(query).toEqual({ limit: 64 }); if (state.fail) throw Object.assign(Error("read failed"), { code: "db/locked" }); return page(); },
    observe: (_query: unknown, next: typeof handler) => { handler = next; return { dispose() { disposed++; } }; },
    control: async (id: string, action: string) => {
      controls.push({ id, action }); if (state.fail) throw Object.assign(Error("write failed"), { code: "db/locked" });
      if (action !== "run") state.schedule.paused = action === "pause";
      return { status: state.alreadyRunning ? "already-running" : "completed", schedule: structuredClone(state.schedule) };
    },
  }, ui: { publishView: async (_channel: unknown, frame: { view: PluginView }) => { published.push(frame.view); } } } } as unknown as RssPluginContext;
  return { ctx, state, page, controls, published, emit: () => handler(page()), disposed: () => disposed };
}
function detail(view: PluginView): PluginDetailView {
  if (view.kind !== "detail") throw Error("Expected detail");
  return view;
}
const action = (view: PluginView, id: string) => detail(view).actions!.find(action => action.id === id)!;

test("schedule controls address only the own schedule and preserve the displayed pause intent", async () => {
  const f = fixture(), view = await refreshScheduleView(f.ctx);
  expect(f.controls).toHaveLength(0);
  f.state.schedule.paused = true;
  expect(await action(view, "pause").run!()).toEqual({ toast: "Automatic refresh paused" });
  expect(f.controls).toEqual([{ id: "refresh-feeds", action: "pause" }]);
  const paused = await refreshScheduleView(f.ctx);
  expect(await action(paused, "resume").run!()).toEqual({ toast: "Automatic refresh resumed" });
  f.state.alreadyRunning = true;
  expect(await action(paused, "run").run!()).toEqual({ toast: "Refresh is already running" });
  f.state.alreadyRunning = false;
  expect(await action(paused, "run").run!()).toEqual({ toast: "Scheduled refresh completed" });
  f.state.fail = true;
  await expect(action(paused, "resume").run!() as Promise<unknown>).rejects.toMatchObject({ code: "db/locked" });
  await expect(refreshScheduleView(f.ctx)).rejects.toMatchObject({ code: "db/locked" });
});

test("live state exposes failure codes and persisted timestamps, then releases and rejects late frames", async () => {
  const f = fixture(), view = await refreshScheduleView(f.ctx);
  const subscription = await view.live!.subscribe({ id: "schedule", generation: 1 } as never);
  f.state.schedule = { ...f.state.schedule, paused: true, running: true, lastStartedAt: 1_000_000 };
  await f.emit();
  expect(JSON.stringify(f.published[f.published.length - 1])).toContain("Running");
  f.state.schedule = { ...f.state.schedule, running: false, lastOutcome: "failed", lastErrorCode: "plugin/network-timeout", lastFinishedAt: 1_001_000 };
  await f.emit();
  expect(JSON.stringify(f.published[f.published.length - 1])).toContain('"code":"plugin/network-timeout"');
  expect(JSON.stringify(f.published[f.published.length - 1])).toContain("Last successful refresh");
  f.state.missing = true; await f.emit();
  expect(detail(f.published[f.published.length - 1]!).actions!.map(action => action.id)).toEqual(["refresh"]);
  subscription.dispose(); subscription.dispose(); const count = f.published.length;
  await f.emit(); expect(f.published).toHaveLength(count); expect(f.disposed()).toBe(1);
});

test("compiled subscriptions command exposes schedule controls even with no feeds", async () => {
  const f = fixture(); let run!: () => Promise<PluginViewResult>;
  Object.assign(f.ctx, { domains: { library: { commands: {}, events: { subscribe() {} } }, reading: { commands: {} } }, contributions: {
    commands: { register: (value: { run: typeof run }) => { run = value.run; } }, headerActions: { register() {} },
    contentProviders: { register() {} }, agentTools: { register() {} },
  } });
  Object.assign(f.ctx.services, { network: {}, storage: { collection: () => ({ list: async () => [] }) } });
  Object.assign(f.ctx.services.schedules, { bind() {} });
  const built = await Bun.build({ entrypoints: [new URL("../src/index.ts", import.meta.url).pathname], target: "browser" });
  expect(built.success).toBe(true);
  const module = (await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0]!.text()).toString("base64")}`)).default as PluginModule;
  await module.activate(f.ctx);
  const root = (await run())!.view;
  if (root?.kind !== "list") throw Error("Expected subscriptions");
  const next = await root.actions!.find(action => action.id === "schedule")!.run();
  expect(next?.view?.kind).toBe("detail"); expect(f.controls).toHaveLength(0);
  expect(manifest.requires.services.schedules).toBe("^1.1.0"); expect(manifest.requires.services.ui).toBe("^1.2.0");
});

test("schedule labels cover all eight app locales without raw error messages", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const t = scheduleCopy(locale); expect(Object.values(t).every(value => typeof value === "string" && value.length > 0)).toBe(true);
    const f = fixture(), view = await refreshScheduleView({ ...f.ctx, locale });
    expect(detail(view).title).toBe(t.title);
  }
});
