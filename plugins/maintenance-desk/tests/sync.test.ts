import { expect, mock, test } from "bun:test";
import type { PluginCommand, PluginContext, PluginModule, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { maintenanceDesk } from "../src/views";

type Sync = NonNullable<PluginContext["services"]["sync"]>;
type Snapshot = Awaited<ReturnType<Sync["snapshot"]>>;
type FlowReceipt = Awaited<ReturnType<Sync["requestFlow"]>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function view(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("Expected a view");
  return result.view;
}
function action(current: PluginView, id: string) {
  if (!("actions" in current)) throw Error("Expected actions");
  const found = current.actions?.find(item => item.id === id);
  if (!found) throw Error(`Missing action: ${id}`);
  return found;
}
async function select(current: PluginView, id: string) {
  if (current.kind !== "list") throw Error("Expected a list");
  return view(await current.items.find(item => item.id === id)!.onSelect!());
}
function fixture() {
  let handler!: (value: Snapshot) => unknown, command!: PluginCommand;
  const state: Snapshot = { revision: 1, supported: true, connectionBusy: false, state: "idle", connected: true,
    backend: "relay", lastSyncAt: null, lastErrorCode: null, progress: null,
    cycleStartBacklog: { events: 12, blobs: 3 }, lastCycle: { pulled: 2, pushed: 1, blobs: 1, backfilled: 0 }, backfillRemaining: 9 };
  const flow = deferred<FlowReceipt>(), sync = deferred<Awaited<ReturnType<Sync["requestSync"]>>>();
  const requestFlow = mock((_request: Parameters<Sync["requestFlow"]>[0], _options?: { signal?: AbortSignal }) => flow.promise);
  const requestSync = mock(() => sync.promise);
  const backlog = mock(async () => ({ events: 7, blobs: 2 }));
  const account = mock(async (): ReturnType<Sync["account"]> => ({ tier: "free", hasBilling: true,
    blobBytesUsed: 512, eventsUsed: 22, aiCreditsUsed: 0,
    limits: { maxBlobBytes: 1024, maxAccountBlobBytes: null, maxAccountEvents: 100, aiMonthlyCredits: 0 } }));
  const connectionOptions = mock(async () => [{ ref: "webdav-sync:webdav", label: "WebDAV" }]);
  const openSettings = mock(async () => ({ status: "opened", surface: "dataSync" }));
  const disposeObserver = mock(() => {}), publishView = mock(async (_channel: unknown, _update: { revision: number; view: PluginView }) => ({ status: "applied" }));
  const ctx = { locale: "en", domains: { settings: { commands: { refreshModelCatalog: mock() } } },
    contributions: { commands: { register: (value: PluginCommand) => { command = value; } }, headerActions: { register: mock() } },
    services: { maintenance: {}, diagnostics: {}, ui: { publishView }, logging: { write: mock(async () => {}) },
      sync: { snapshot: mock(async () => state), requestFlow, requestSync, backlog, account, connectionOptions, openSettings,
        observe: (next: typeof handler) => { handler = next; return { dispose: disposeObserver }; } } },
  } as unknown as PluginContext;
  return { ctx, state, flow, sync, requestFlow, requestSync, backlog, account, connectionOptions, openSettings, disposeObserver, publishView,
    changed: (value: Snapshot) => handler(value), command: () => command };
}

test("sync overview stays local, distinguishes live backlog from cycle-start counts, and disposes observation", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const overview = await select(desk.home(), "sync");
  expect(f.account).not.toHaveBeenCalled();
  expect(f.backlog).not.toHaveBeenCalled();
  expect(f.requestSync).not.toHaveBeenCalled();
  expect(f.requestFlow).not.toHaveBeenCalled();
  expect(JSON.stringify(overview)).toContain("Backlog at cycle start");
  const fresh = view(await action(overview, "backlog").run());
  expect(JSON.stringify(fresh)).toContain('"value":"7"');
  await overview.live!.subscribe({ id: "sync" });
  f.changed({ ...f.state, state: "syncing", progress: { phase: "push", pulled: 0, pushed: 3, verified: 2, backfilled: 0, blobsDone: 1, blobsTotal: 3 } });
  const updated = f.publishView.mock.calls[0]![1].view;
  expect(JSON.stringify(updated)).toContain('"value":null');
  expect("actions" in updated && updated.actions?.some(item => item.id === "sync")).toBe(false);
  expect(await action(updated, "settings").run()).toEqual({ close: true });
  desk.dispose();
  expect(f.disposeObserver).toHaveBeenCalledTimes(1);
  f.changed(f.state);
  expect(f.publishView).toHaveBeenCalledTimes(1);
});

test.each(["completed", "already-running"] as const)("synchronization journal preserves %s instead of claiming all data is synchronized", async status => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const overview = await select(desk.home(), "sync");
  const review = view(await action(overview, "sync").run());
  expect(f.requestSync).not.toHaveBeenCalled();
  const waiting = view(await action(review, "continue").run());
  expect(JSON.stringify(waiting)).toContain("Awaiting host result");
  expect(await action(review, "continue").run()).toHaveProperty("toast");
  expect(f.requestSync).toHaveBeenCalledTimes(1);
  f.sync.resolve({ status, snapshot: f.state }); await tick();
  const history = await select(desk.home(), "results");
  expect(JSON.stringify(history)).toContain(status === "completed" ? "Synchronization request completed" : "A synchronization was already running");
  desk.dispose();
});

test("backend selection freezes the public reference and cancellation does not accept late success", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  f.state.connected = false; f.state.backend = null; f.state.state = "disabled";
  const overview = await select(desk.home(), "sync");
  const choices = view(await action(overview, "connect").run());
  const review = await select(choices, "backend-1");
  expect(JSON.stringify(review)).toContain("WebDAV");
  expect(f.requestFlow).not.toHaveBeenCalled();
  expect(await action(review, "continue").run()).toEqual({ close: true });
  expect(f.requestFlow.mock.calls[0]![0]).toEqual({ action: "connect", transportRef: "webdav-sync:webdav" });
  const history = await select(desk.home(), "results");
  if (history.kind !== "detail") throw Error("Expected a detail");
  const progress = history.content.find(block => block.kind === "progress");
  if (progress?.kind !== "progress") throw Error("Expected progress");
  await progress.cancel!.run();
  expect(f.requestFlow.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  f.flow.resolve({ action: "connect", status: "completed" }); await tick();
  expect(JSON.stringify(await select(desk.home(), "results"))).toContain("Wait cancelled; started operations may continue");
  desk.dispose();
});

test.each(["disconnect", "delete-account", "upgrade", "billing"] as const)("%s waits across modal closure and records the native outcome", async actionId => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const overview = await select(desk.home(), "sync");
  const source = actionId === "disconnect" ? overview : view(await action(overview, "account").run());
  const review = view(await action(source, actionId).run());
  expect(f.requestFlow).not.toHaveBeenCalled();
  expect(action(review, "continue").variant).toBe(actionId === "delete-account" ? "danger" : "solid");
  expect(await action(review, "continue").run()).toEqual({ close: true });
  expect(f.requestFlow.mock.calls[0]![0]).toEqual({ action: actionId });
  const external = actionId === "upgrade" || actionId === "billing";
  f.flow.resolve({ action: actionId, status: external ? "external-opened" : "completed" }); await tick();
  expect(JSON.stringify(await select(desk.home(), "results"))).toContain(external ? "External page opened; account changes not verified" : "Native account operation completed");
  desk.dispose();
});

test("account limits keep zero and unlimited distinct; null is not a failed remote read", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const overview = await select(desk.home(), "sync");
  const account = view(await action(overview, "account").run());
  expect(JSON.stringify(account)).toContain('"value":"Unlimited"');
  expect(JSON.stringify(account)).toContain('"label":"Monthly AI credit limit","value":"0"');
  f.account.mockResolvedValueOnce(null);
  expect(JSON.stringify(view(await action(account, "refresh").run()))).toContain("No connected Relay account");
  f.account.mockRejectedValueOnce({ code: "sync/network" });
  await expect(action(account, "refresh").run()).rejects.toMatchObject({ code: "sync/network" });
  f.backlog.mockRejectedValueOnce({ code: "db/locked" });
  await expect(action(overview, "backlog").run()).rejects.toMatchObject({ code: "db/locked" });
  desk.dispose();
});

test("compiled command composes sync and retires a pending native flow", async () => {
  const f = fixture();
  const built = (await import(new URL("../dist/main.js", import.meta.url).href) as { default: PluginModule }).default;
  try {
    await built.activate(f.ctx);
    const overview = await select(view(await f.command().run()), "sync");
    const review = view(await action(overview, "disconnect").run());
    await action(review, "continue").run();
    await built.deactivate?.();
    expect(f.requestFlow.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    f.flow.resolve({ action: "disconnect", status: "cancelled" }); await tick();
  } finally { await built.deactivate?.(); }
});
