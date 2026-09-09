import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { createReaderPanelIntent, readerPanelIntentAtom, type ReaderPanelKind } from "../../../reader/state/panel-intent";
import { askAiRequestAtom } from "../../../ai/state/chat-intent";

const workers = new Map<string, SandboxedPlugin>();
const owned: PluginDisposable[] = [];
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
}
export async function preparePanelActors() {
  await isolated(); if (workers.size) throw Error("Clean up existing panel probes");
  try {
    for (const actor of ["empty", "read", "write"] as const) {
      const manifest: PluginManifest = { id: `capability-panels-${actor}`, name: `Panel ${actor}`, version: "1.0.0", schemaVersion: 1,
        permissions: actor === "empty" ? [] : [actor === "read" ? "reading:read" : "reading:write"], requires: { services: { ui: "^1.1.0" } } };
      const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./panel-probe.ts", import.meta.url).href });
      workers.set(actor, worker); await worker.checkHealth(); worker.promote();
    }
    return { empty: await panelActor("empty"), read: await panelActor("read"), write: await panelActor("write") };
  } catch (error) { await cleanupPanelActors(); throw error; }
}
export async function panelActor(actor: "empty" | "read" | "write", action = "inspect") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === `capability-panels-${actor}` && command.id === action);
  if (!command) throw Error("Panel probe command unavailable");
  const result = await command.run();
  return result?.toast ? JSON.parse(result.toast) : null;
}
export async function dispatchPanelIntent(bookId: string, panel: ReaderPanelKind | "ask") {
  await isolated();
  const store = getDefaultStore();
  if (panel === "ask") store.set(askAiRequestAtom, { id: crypto.randomUUID(), bookId });
  else store.set(readerPanelIntentAtom, createReaderPanelIntent(bookId, panel));
}
export async function cleanupPanelActors() {
  await isolated();
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  return { remaining: ["empty", "read", "write"].reduce((n, actor) => n + inspectContributions(`capability-panels-${actor}`).length, 0) };
}
