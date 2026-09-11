import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { i18n } from "../../src/i18n";
import { closePluginDialog, pluginCommandsAtom, pluginDialogAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";

const actors = new Map<string, { worker: SandboxedPlugin; disposables: PluginDisposable[] }>();
const id = "capability-live-view", foreign = "capability-live-foreign";
const store = getDefaultStore();
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>("button")]
  .find(element => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8_000;
  while (!await check()) {
    if (Date.now() > deadline) throw Error("Live view probe timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function isolated() {
  const dataDir = await appDataDir();
  assert(dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e"), "Use isolated capability-e2e app");
  return dataDir;
}
async function start(actor: string, description?: string) {
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker({ id: actor, name: actor, version: "1.0.0", schemaVersion: 1, permissions: [], description,
    requires: { services: { ui: "^1.2.0" }, schemas: { views: "^1.1.0" } } }, "0.5.4", disposables,
  { moduleUrl: new URL("./live-view-probe.ts", import.meta.url).href });
  actors.set(actor, { worker, disposables }); await worker.checkHealth(); worker.promote();
}
async function stop(actor: string) {
  const current = actors.get(actor); if (!current) return;
  try { await current.worker.terminate(); }
  finally { for (const disposable of current.disposables.reverse()) disposable.dispose(); actors.delete(actor); }
}
const command = (actor: string, name: string) => {
  const found = store.get(pluginCommandsAtom).find(command => command.pluginId === actor && command.id === name);
  if (!found) throw Error(`Missing probe command: ${actor}/${name}`);
  return found;
};
async function call(name: string, actor = id) { return parseProbeToast((await command(actor, name).run())!.toast!); }
async function open(name = "open") {
  await runPluginContribution(id, "Live view probe", command(id, name).run, { presentation: "dialog" });
  await until(() => !!dialog()?.querySelector("input"));
  await until(async () => !!(await call("inspect")).channel);
}
async function close() {
  const request = store.get(pluginDialogAtom); if (request?.pluginId === id) closePluginDialog(request.requestId);
  await until(() => !dialog());
}

/** Real Worker publication and React/WebKit presentation; no business data is mutated. */
export async function runDesktopLiveViewProbe() {
  const dataDir = await isolated(); assert(!actors.size, "Clean up previous live probe first");
  const results: string[] = [];
  try {
    await start(id); await open();
    const initial = await call("inspect");
    await start(foreign, JSON.stringify(initial.channel));
    assert((await call("foreign", foreign)).status === "inactive", "Foreign activation published into another view");
    results.push("foreign activation denied without channel discovery");

    const input = dialog()!.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "User draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    assert((await call("advance")).status === "applied", "Publication not applied");
    await until(() => !!button("Action 1", dialog()!));
    assert(dialog()!.querySelector<HTMLInputElement>("input")!.value === "User draft", "Live update reset user draft");
    assert((await call("stale")).status === "stale", "Old revision was applied");
    button("Action 1", dialog()!)!.click();
    await until(() => dialog()?.textContent?.includes("Action result 1") === true);
    await until(async () => (await call("inspect")).disposed === 1);
    assert((await call("advance")).status === "inactive", "Hidden parent accepted updates");
    button(String(i18n.t("plugins:viewer.back")), dialog()!)!.click();
    await until(() => !!button("Action 2", dialog()!));
    assert(dialog()!.querySelector<HTMLInputElement>("input")!.value === "User draft", "Back navigation reset user draft");
    const resumed = await call("inspect"); assert(resumed.channel.id !== initial.channel.id, "Resumed view reused expired channel");
    results.push("live callback remains callable after RPC; revisions, drafts, push/back and fresh resubscription verified");

    button("Open live modal", dialog()!)!.click();
    await until(() => document.querySelectorAll('[role="dialog"]').length === 2);
    await until(async () => (await call("inspect")).disposed === 2);
    const nested = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(node => node.textContent?.includes("Independent modal"))!;
    button(String(i18n.t("plugins:viewer.close")), nested)!.click();
    await until(async () => (await call("inspect")).subscriptions === 3);
    assert((await call("invalid")).code === "plugin/invalid-input", "Malformed publication lost stable code");
    await until(async () => (await call("inspect")).disposed === 3);
    assert(dialog()?.textContent?.includes("private malformed payload") === false, "Raw error leaked");
    assert(!!dialog()?.querySelector("input"), "Failure discarded last good view");
    results.push("modal suspends source; malformed update stops subscription, preserves content and hides raw error");

    await close(); await open("slow");
    await until(async () => (await call("inspect")).subscriptions === 4);
    await close();
    assert((await call("advance")).status === "inactive", "Closed view accepted late update");
    await call("finish"); await until(async () => (await call("inspect")).disposed === 4);
    results.push("late subscription acknowledgement disposed after close; late publication inactive");

    await open(); await stop(id); await until(() => !dialog());
    assert(inspectContributions(id).length === 0, "Worker left contributions");
    results.push("activation retirement closes visible live view and removes contributions");
    await start(id); await open(); await call("advance");
    await until(() => !!button("Action 1", dialog()!));
    return { dataDir, results, preview: true, visibility: document.visibilityState, focused: document.hasFocus() };
  } catch (error) { await cleanupDesktopLiveViewProbe(); throw error; }
}

export async function cleanupDesktopLiveViewProbe() {
  await isolated(); await close();
  for (const actor of [...actors.keys()]) await stop(actor);
  return { contributions: [id, foreign].map(actor => ({ id: actor, count: inspectContributions(actor).length })), dialog: !!store.get(pluginDialogAtom) };
}
