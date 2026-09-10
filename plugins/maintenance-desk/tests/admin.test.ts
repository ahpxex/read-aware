import { expect, mock, test } from "bun:test";
import type { PluginCommand, PluginContext, PluginModule, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { maintenanceDesk } from "../src/views";

type Directory = PluginContext["services"]["plugins"];
type Page = Awaited<ReturnType<Directory["list"]>>;
type Contributions = Awaited<ReturnType<Directory["contributions"]>>;
type Snapshot = Awaited<ReturnType<PluginContext["services"]["maintenance"]["snapshot"]>>;
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
  let directoryHandler!: (page: Page) => void, contributionHandler!: (page: Contributions) => void;
  let updateHandler!: (snapshot: Snapshot) => void;
  let command!: PluginCommand;
  const entry = { id: "jumper", name: "Jumper", version: "0.4.0", enabled: true, builtin: false, activationFailed: true };
  const page: Page = { plugins: [entry], total: 41, offset: 0, nextOffset: 40 };
  const contributions: Contributions = { contributions: [{ point: "commands", pluginId: "jumper", key: "open" }], total: 1, offset: 0, nextOffset: null };
  const state: Snapshot = { phase: "idle", currentVersion: "0.3.0", availableVersion: null, progress: null,
    errorStage: null, supported: true, channel: "beta", checkedChannel: "stable" };
  const list = mock(async (query: Parameters<Directory["list"]>[0]) => ({ ...page, offset: query?.offset ?? 0 }));
  const readContributions = mock(async (_query: Parameters<Directory["contributions"]>[0]) => contributions);
  const snapshot = mock(async () => state);
  const checkForUpdates = mock(async (): Promise<Snapshot> => ({ ...state, phase: "available", availableVersion: "0.4.0", checkedChannel: "beta" }));
  const openSettings = mock(async (surface: string) => ({ status: "opened", surface }));
  const disposeDirectory = mock(() => {}), disposeContributions = mock(() => {}), disposeUpdates = mock(() => {});
  const publishView = mock(async (_channel: unknown, _update: { revision: number; view: PluginView }) => ({ status: "applied" }));
  const ctx = { locale: "en", domains: { settings: { commands: { refreshModelCatalog: mock() } } },
    contributions: { commands: { register: (value: PluginCommand) => { command = value; } }, headerActions: { register: mock() } },
    services: {
      plugins: { list, contributions: readContributions,
        observe: (_query: unknown, handler: typeof directoryHandler) => { directoryHandler = handler; return { dispose: disposeDirectory }; },
        observeContributions: (_query: unknown, handler: typeof contributionHandler) => { contributionHandler = handler; return { dispose: disposeContributions }; } },
      maintenance: { snapshot, checkForUpdates, openSettings,
        observe: (handler: typeof updateHandler) => { updateHandler = handler; return { dispose: disposeUpdates }; } },
      diagnostics: {}, ui: { publishView }, logging: { write: mock(async () => {}) },
    },
  } as unknown as PluginContext;
  return { ctx, page, contributions, state, list, readContributions, snapshot, checkForUpdates, openSettings, publishView,
    disposeDirectory, disposeContributions, disposeUpdates, command: () => command,
    directoryChanged: (value: Page) => directoryHandler(value), contributionsChanged: (value: Contributions) => contributionHandler(value),
    updateChanged: (value: Snapshot) => updateHandler(value) };
}

test("directory, metadata and contribution identities compose without mutating installed plugins", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const directory = await select(desk.home(), "plugins");
  expect(f.list).toHaveBeenCalledWith({ offset: 0, limit: 40 });
  const details = await select(directory, "jumper");
  expect(JSON.stringify(details)).toContain("Configured enabled");
  expect(JSON.stringify(details)).toContain("Activation failed");
  const entries = view(await action(details, "contributions").run());
  expect(f.readContributions).toHaveBeenCalledWith({ pluginId: "jumper", offset: 0, limit: 40 });
  if (entries.kind !== "list") throw Error("Expected a list");
  expect(entries.items[0]?.onSelect).toBeUndefined();
  expect(f.openSettings).not.toHaveBeenCalled();
  expect(await action(details, "manage").run()).toEqual({ close: true });
  expect(f.openSettings).toHaveBeenCalledWith("plugins");
  desk.dispose();
});

test("directory pagination and search use the host query; live changes replace rather than append", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const directory = await select(desk.home(), "plugins");
  if (directory.kind !== "list") throw Error("Expected a list");
  const second = view(await directory.pagination!.onNext!());
  expect(f.list.mock.calls[1]![0]).toEqual({ offset: 40, limit: 40 });
  const subscription = await second.live!.subscribe({ id: "directory" });
  f.directoryChanged({ plugins: [], total: 1, offset: 40, nextOffset: null });
  const changed = f.publishView.mock.calls[0]![1].view;
  if (changed.kind !== "list") throw Error("Expected a list");
  expect(changed.items).toEqual([]);
  expect(changed.pagination!.onPrevious).toBeDefined();
  const search = view(await action(changed, "search").run());
  if (search.kind !== "form") throw Error("Expected a form");
  expect(await search.onSubmit({ search: "x".repeat(201) })).toHaveProperty("fieldErrors.search");
  await search.onSubmit({ search: "  Jumper  " });
  expect(f.list.mock.calls[f.list.mock.calls.length - 1]![0]).toEqual({ search: "Jumper", offset: 0, limit: 40 });
  subscription.dispose();
  f.directoryChanged(f.page);
  expect(f.publishView).toHaveBeenCalledTimes(1);
  expect(f.disposeDirectory).toHaveBeenCalledTimes(1);
  desk.dispose();
});

test("contribution observer is activation-owned and keeps duplicate keys across extension points", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const directory = await select(desk.home(), "plugins");
  const entries = view(await action(directory, "contributions").run());
  await entries.live!.subscribe({ id: "contributions" });
  f.contributionsChanged({ ...f.contributions, total: 2, contributions: [
    f.contributions.contributions[0]!, { point: "headerActions", pluginId: "jumper", key: "open" },
  ] });
  const changed = f.publishView.mock.calls[0]![1].view;
  if (changed.kind !== "list") throw Error("Expected a list");
  expect(new Set(changed.items.map(item => item.id)).size).toBe(2);
  desk.dispose();
  expect(f.disposeContributions).toHaveBeenCalledTimes(1);
  f.contributionsChanged(f.contributions);
  expect(f.publishView).toHaveBeenCalledTimes(1);
});

test("updates are read-only on opening; explicit check renders its receipt and native handoff only opens settings", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  const updates = await select(desk.home(), "updates");
  expect(f.checkForUpdates).not.toHaveBeenCalled();
  expect(JSON.stringify(updates)).toContain("Last successfully checked channel");
  expect(JSON.stringify(updates)).toContain("Stable");
  const checked = view(await action(updates, "check").run());
  expect(JSON.stringify(checked)).toContain("0.4.0");
  expect(f.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  await checked.live!.subscribe({ id: "updates" });
  f.updateChanged({ ...f.state, phase: "downloading", progress: 42 });
  const changed = f.publishView.mock.calls[0]![1].view;
  if (changed.kind !== "detail") throw Error("Expected a detail");
  expect(changed.content).toContainEqual({ kind: "progress", value: 42, max: 100, label: "Downloading" });
  expect(changed.actions?.some(item => item.id === "check")).toBe(false);
  expect(await action(changed, "manage").run()).toEqual({ close: true });
  expect(f.openSettings).toHaveBeenCalledWith("updates");
  desk.dispose();
  expect(f.disposeUpdates).toHaveBeenCalledTimes(1);
  f.updateChanged(f.state);
  expect(f.publishView).toHaveBeenCalledTimes(1);
});

test("unsupported and unauthorized checks are omitted; failures are not empty directories or successful updates", async () => {
  const f = fixture(), desk = maintenanceDesk(f.ctx);
  f.state.supported = false;
  const unsupported = await select(desk.home(), "updates");
  expect(JSON.stringify(unsupported)).toContain("Updates unavailable on this platform");
  expect("actions" in unsupported && unsupported.actions?.some(item => item.id === "check")).toBe(false);
  f.state.supported = true;
  f.checkForUpdates.mockRejectedValueOnce({ code: "sync/network" });
  const updates = await select(desk.home(), "updates");
  await expect(action(updates, "check").run()).rejects.toMatchObject({ code: "sync/network" });
  f.ctx.services.maintenance.checkForUpdates = undefined;
  const readonly = await select(desk.home(), "updates");
  expect("actions" in readonly && readonly.actions?.some(item => item.id === "check")).toBe(false);
  f.list.mockRejectedValueOnce({ code: "db/locked" });
  await expect(select(desk.home(), "plugins")).rejects.toMatchObject({ code: "db/locked" });
  desk.dispose();
  await expect(select(desk.home(), "updates")).rejects.toThrow();
});

test("compiled entry exposes both management workflows through its registered command", async () => {
  const f = fixture();
  const built = (await import(new URL("../dist/main.js", import.meta.url).href) as { default: PluginModule }).default;
  try {
    await built.activate(f.ctx);
    const home = view(await f.command().run());
    const directory = await select(home, "plugins");
    expect(directory.kind).toBe("list");
    const updates = await select(home, "updates");
    expect(updates.kind).toBe("detail");
    expect(f.checkForUpdates).not.toHaveBeenCalled();
  } finally { await built.deactivate?.(); }
});
