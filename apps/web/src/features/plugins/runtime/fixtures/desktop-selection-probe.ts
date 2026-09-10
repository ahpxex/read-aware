import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { prepareRangeProbe, cleanupRangeProbe } from "./desktop-range-probe";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildReaderTools } from "../../../../../../../packages/agent/src/tools/reader-tools";
import { buildNavigationTools } from "../../../../../../../packages/agent/src/tools/navigation-tools";

const workers: SandboxedPlugin[] = [], disposables: PluginDisposable[] = [], ids: string[] = [];
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
export async function prepareSelectionProbe() {
  await isolated(); if (workers.length) throw Error("Clean previous probe first");
  const seed = await prepareRangeProbe();
  for (const access of ["none", "read", "write"] as const) {
    const id = `capability-selection-${access}`; ids.push(id);
    const manifest: PluginManifest = { id, name: "Selection probe", version: "1.0.0", schemaVersion: 1,
      permissions: access === "none" ? [] : [`reading:${access}`, "library:read"],
      requires: access === "none" ? {} : { domains: { reading: "^2.10.0", library: "^1.7.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./selection-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function sampleSelectionProbe() {
  await isolated();
  const deps = buildRuntimeDeps(), snapshot = await deps.reader.getSession();
  const worker: Record<string, unknown> = {};
  for (const id of ids) {
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id);
    if (!command) throw Error("Probe command missing");
    worker[id] = JSON.parse((await command.run())!.toast!);
  }
  const scope = { kind: "book" as const, bookId: snapshot.bookId ?? "missing" };
  const tool = buildReaderTools(scope, deps).find(tool => tool.name === "get_reading_session")!;
  const result = await tool.execute("selection-native", {});
  const agent = result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : null;
  const read = buildNavigationTools(scope, deps).find(tool => tool.name === "read_book_range")!;
  const page = agent?.selection?.range ? await read.execute("selection-native-read", { range: agent.selection.range }) : null;
  return { worker, agent, page, after: await deps.reader.getSession() };
}
export async function cleanupSelectionProbe() {
  await isolated();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const item of disposables.splice(0).reverse()) item.dispose();
  const contributions = ids.map(id => [id, inspectContributions(id).length]); ids.splice(0);
  return { contributions, range: await cleanupRangeProbe() };
}
