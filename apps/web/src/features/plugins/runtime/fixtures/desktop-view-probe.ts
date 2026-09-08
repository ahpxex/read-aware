import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDetailView, PluginDisposable } from "@read-aware/plugin-types";
import { i18n } from "../../../../i18n";
import { closePluginDialog, pluginCommandsAtom, pluginDialogAtom } from "../../state/plugin-store";
import { runPluginContribution } from "../../lib/run-result";
import { startPluginWorker } from "../plugin-worker-host";

async function until(check: () => boolean) {
  const deadline = Date.now() + 4_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("View probe condition timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>("button")]
  .find(element => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
const dialog = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(element => element.textContent?.includes(text));

/** Actual app DialogHost, renderer events and WebKit Worker, not a browser mock. */
export async function runDesktopViewProbe() {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use the isolated capability-e2e Tauri app");
  const id = "capability-view-lifetime";
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker({ id, name: "View lifetime probe", version: "1.0.0", schemaVersion: 1, permissions: [], requires: {} }, "0.5.4", disposables, {
    moduleUrl: new URL("./view-probe.ts", import.meta.url).href,
  });
  const store = getDefaultStore();
  const results: string[] = [];
  const retired = async (view: PluginDetailView) => {
    let code: string | undefined;
    try { await view.actions![0].run(); } catch (error) { code = (error as { code?: string }).code; }
    if (code !== "plugin/unavailable") throw new Error("Retired view callback is still callable");
  };
  try {
    await worker.checkHealth(); worker.promote();
    const commands = store.get(pluginCommandsAtom).filter(command => command.pluginId === id);
    const open = commands.find(command => command.id === "open")!;
    const load = async () => {
      await runPluginContribution(id, "View lifetime probe", open.run, { presentation: "dialog" });
      await until(() => !!button("Push", dialog("Root view")));
      return store.get(pluginDialogAtom)!.view as PluginDetailView;
    };
    const first = await load();
    button("Push", dialog("Root view"))!.click();
    await until(() => !!dialog("Child view"));
    if ((await first.actions![0].run())?.toast !== "alive") throw new Error("Push retired its parent");
    button(String(i18n.t("plugins:viewer.back")), dialog("Child view"))!.click();
    await until(() => !!button("Push", dialog("Root view")));
    results.push("push/back preserves parent callbacks");

    button("Open modal", dialog("Root view"))!.click();
    await until(() => !!dialog("Modal view"));
    button(String(i18n.t("plugins:viewer.close")), dialog("Modal view"))!.click();
    await until(() => !dialog("Modal view"));
    if ((await first.actions![0].run())?.toast !== "alive") throw new Error("Modal close retired its parent");
    results.push("nested dialog closes independently");

    button("Replace", dialog("Root view"))!.click();
    await until(() => !!dialog("Replacement view"));
    await retired(first);
    results.push("replace releases root callback");

    const reset = await load();
    button("Reset", dialog("Root view"))!.click();
    await until(() => !!dialog("Reset view"));
    await retired(reset);
    results.push("reset releases prior stack");

    const slow = await load();
    button("Slow", dialog("Root view"))!.click();
    closePluginDialog(store.get(pluginDialogAtom)!.requestId);
    await until(() => !dialog("Root view"));
    await new Promise(resolve => setTimeout(resolve, 350));
    await retired(slow);
    if (store.get(pluginDialogAtom) || document.body.textContent?.includes("unexpected late toast")) throw new Error("Late result produced UI");
    results.push("closed action discards late view and toast");

    for (let index = 0; index < 10; index++) {
      const view = await load();
      closePluginDialog(store.get(pluginDialogAtom)!.requestId);
      await until(() => !dialog("Root view"));
      await retired(view);
    }
    results.push("10 repeated opens/closes retire callbacks");

    const pendingCommand = commands.find(command => command.id === "slow")!;
    const pending = runPluginContribution(id, "View lifetime probe", pendingCommand.run, { presentation: "dialog" });
    await worker.terminate();
    await pending;
    if (store.get(pluginDialogAtom)) throw new Error("Worker retirement left a pending dialog");
    results.push("Worker retirement closes pending dialog");
    return { dataDir, results, cleanupOwners: disposables.length, visibility: document.visibilityState, focused: document.hasFocus() };
  } finally {
    const request = store.get(pluginDialogAtom);
    if (request?.pluginId === id) closePluginDialog(request.requestId);
    try { await worker.terminate(); }
    finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
  }
}
