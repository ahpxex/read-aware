import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { localKV } from "../../src/platform/local-store";
import { getAgentRuntime } from "../../src/features/ai/agent/agent-runtime";
import { createLibraryDomain } from "../../src/domain/library";
import { pluginCommandsAtom, selectionActionsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginDocsClear, pluginDocsList } from "../../src/features/plugins/runtime/plugin-backend";
import dictionaryManifest from "../../../../plugins/dictionary/manifest.json";

const dictionaryId = "capability-structured-dictionary";
const probeId = "capability-structured-reading";
const owned: PluginDisposable[] = [];
const workers: SandboxedPlugin[] = [];
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
}
export async function prepareStructuredReadingProbe() {
  await isolated();
  if (workers.length) throw Error("Already running");
  if (!getAgentRuntime()) throw Error("Configure isolated inference probe first");
  for (const [manifest, moduleUrl] of [
    [{ ...dictionaryManifest, id: dictionaryId }, new URL("../../../../plugins/dictionary/dist/main.js", import.meta.url).href],
    [{ id: probeId, name: "Structured reading", version: "1.0.0", schemaVersion: 1, permissions: ["service:llm"],
      requires: { services: { llm: "^1.1.0" } } }, new URL("./structured-reading-probe.ts", import.meta.url).href],
  ] as Array<[PluginManifest, string]>) {
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  return { workers: workers.length };
}
export async function dictionaryReadingProbe(suffix: string) {
  await isolated();
  const action = getDefaultStore().get(selectionActionsAtom).find(action => action.pluginId === dictionaryId);
  if (!action) throw Error("Dictionary action unavailable");
  const book = (await createLibraryDomain("user").queries.books.list()).find(book => book.title === "Reading Capability Probe");
  if (!book) throw Error("Existing synthetic Reading Capability Probe book required");
  try {
    const result = await action.run({ text: `SELECTION_MARKER_947_${suffix}`, context: "VIEWPORT_MARKER_628",
      book: { id: book.id, title: book.title }, cfiRange: null, chapterHref: null, source: "selection" });
    return { status: "completed", toast: result?.toast, counts: await dictionaryReadingCounts() };
  } catch (error) {
    return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null,
      counts: await dictionaryReadingCounts() };
  }
}
export async function dictionaryReadingCounts() {
  await isolated();
  return { lookups: (await pluginDocsList(dictionaryId, "lookups")).length, words: (await pluginDocsList(dictionaryId, "words")).length };
}
export async function structuredReadingProbe(actor: "agent" | "plugin", mode: "plain" | "structured" | "stream") {
  await isolated();
  if (actor === "plugin") {
    await localKV.setItemAsync(`read-aware-plugin.${probeId}.mode`, JSON.stringify(mode));
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === probeId && command.id === "ask");
    const receipt = await command?.run();
    if (!receipt?.toast) throw Error("Missing probe result");
    return parseProbeToast(receipt.toast);
  }
  const runtime = getAgentRuntime();
  if (!runtime) throw Error("Runtime unavailable");
  const input = { prompt: "Controlled agent structured reading request", readingContext: {
    selection: "SELECTION_MARKER_947", surrounding: "VIEWPORT_MARKER_628",
  } };
  const deltas: string[] = [];
  try {
    const text = mode === "structured" ? await runtime.ask({ ...input, schema: { type: "object", required: ["headword", "senses"] } })
      : await runtime.ask({ ...input, ...(mode === "stream" ? { onText: (delta: string) => deltas.push(delta) } : {}) });
    return { status: "completed", text, deltas };
  } catch (error) {
    return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null, deltas };
  }
}
export async function cleanupStructuredReadingProbe() {
  await isolated();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  await pluginDocsClear(dictionaryId);
  await localKV.removeItemAsync(`read-aware-plugin.${probeId}.mode`);
  return { counts: await dictionaryReadingCounts(), actions: getDefaultStore().get(selectionActionsAtom).filter(action => action.pluginId === dictionaryId).length,
    commands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === probeId).length };
}
