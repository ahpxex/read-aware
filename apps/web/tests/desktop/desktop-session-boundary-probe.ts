import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { createLibraryDomain } from "../../src/domain/library";
import { createSettingsDomain } from "../../src/domain/settings/domain";
import { pluginCommandsAtom, pluginToolsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { assertPluginCapabilityRequirements } from "../../src/features/plugins/runtime/plugin-capabilities";
import { pluginDocsPut, pluginDocsClear, pluginDocsList } from "../../src/features/plugins/runtime/plugin-backend";
import { lookupCacheId } from "../../../../plugins/dictionary/src/lookup";
import dictionaryManifest from "../../../../plugins/dictionary/manifest.json";

const dictionaryId = "capability-dictionary-session";
const workers: SandboxedPlugin[] = [];
const owned: PluginDisposable[] = [];
let originalLocalOnly: boolean | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareSessionBoundaryProbe() {
  const path = await isolated();
  if (workers.length || originalLocalOnly !== undefined) throw Error("Probe already active");
  const settings = createSettingsDomain("user");
  originalLocalOnly = (await settings.queries.read("ai.preferences.localOnly")).value as boolean;
  await settings.commands.update([{ path: "ai.preferences.localOnly", value: true }]);
  const books = (await createLibraryDomain("user").queries.books.list()).filter(book => ["Reading Capability Probe", "Reading Paint Probe"].includes(book.title));
  if (books.length !== 2) throw Error("Expected the two existing synthetic probe books");
  for (const title of [...books.map(book => book.title), undefined]) {
    const id = lookupCacheId("boundary-probe", "English", undefined, title);
    await pluginDocsPut(dictionaryId, "lookups", id, JSON.stringify({ entry: { headword: "boundary-probe", senses: [{ definition: title ?? "No current book" }] } }));
  }
  const legacy: PluginManifest = { id: "capability-legacy-session", name: "Legacy", version: "1.0.0", schemaVersion: 1, requires: { services: { session: "^1.0.0" } } };
  let legacyRejected = false;
  try { assertPluginCapabilityRequirements(legacy); } catch { legacyRejected = true; }
  return { path, books: books.map(({ id, title }) => ({ id, title })), legacyRejected };
}
export async function openSessionProbeBook(bookId?: string) {
  await isolated();
  const reader = buildRuntimeDeps().reader;
  if (!bookId) { await reader.close(); return reader.getSession(); }
  const book = await createLibraryDomain("user").queries.books.get(bookId);
  if (!book || !["Reading Capability Probe", "Reading Paint Probe"].includes(book.title)) throw Error("Synthetic books only");
  await reader.goTo({ bookId, fraction: 0 });
  return reader.getSession();
}
export async function startSessionActors() {
  await isolated();
  for (const read of [false, true]) {
    const manifest: PluginManifest = { id: `capability-session-${read ? "reader" : "empty"}`, name: "Session boundary", version: "1.0.0", schemaVersion: 1,
      permissions: read ? ["reading:read"] : [], requires: {} };
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./session-boundary-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  const worker = await startPluginWorker({ ...dictionaryManifest, id: dictionaryId } as PluginManifest, "0.5.4", owned,
    { moduleUrl: new URL("../../../../plugins/dictionary/dist/main.js", import.meta.url).href });
  workers.push(worker); await worker.checkHealth(); worker.promote();
  return readSessionActors();
}
export async function readSessionActors() {
  await isolated();
  const result: Record<string, unknown> = {};
  for (const suffix of ["reader", "empty"]) {
    const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-session-${suffix}` && c.id === "read");
    const receipt = await command?.run();
    if (!receipt?.toast) throw Error("Missing boundary command");
    result[suffix] = parseProbeToast(receipt.toast);
  }
  const tool = getDefaultStore().get(pluginToolsAtom).find(t => t.pluginId === dictionaryId && t.name === "lookup_word");
  if (!tool) throw Error("Dictionary tool unavailable");
  result.dictionary = await tool.execute({ term: "boundary-probe" });
  return result;
}
export async function cleanupSessionBoundaryProbe() {
  await isolated();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  await pluginDocsClear(dictionaryId);
  if (originalLocalOnly !== undefined) {
    await createSettingsDomain("user").commands.update([{ path: "ai.preferences.localOnly", value: originalLocalOnly }]);
    originalLocalOnly = undefined;
  }
  await buildRuntimeDeps().reader.close();
  return { documents: (await pluginDocsList(dictionaryId, "lookups")).length,
    commands: getDefaultStore().get(pluginCommandsAtom).filter(c => c.pluginId.startsWith("capability-session-")).length,
    tools: getDefaultStore().get(pluginToolsAtom).filter(t => t.pluginId === dictionaryId).length,
    localOnly: (await createSettingsDomain("user").queries.read("ai.preferences.localOnly")).value };
}
