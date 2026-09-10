import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { errorCode } from "@read-aware/core";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../../../domain/library";
import { flushLocalKV } from "../../../../platform/local-store";
import { getVirtualBookBinding } from "../../lib/virtual-books";
import { inspectContributions } from "../../state/contribution-registry";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { getPluginAgentTools } from "../plugin-tools";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";

const id = "capability-virtual-removal";
const library = createLibraryDomain(`plugin:${id}`);
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
let bookId: string | undefined;
async function isolated() {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e app");
  return dataDir;
}
const command = (name: string) => {
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === name);
  if (!command) throw Error(`Probe command missing: ${name}`);
  return command;
};

export async function startVirtualRemovalProbe() {
  const dataDir = await isolated();
  if (worker) throw Error("Retire previous removal probe first");
  disposables = [];
  worker = await startPluginWorker({ id, name: "Virtual removal probe", version: "1.0.0", schemaVersion: 1,
    permissions: ["library:write", "agent:tools"], requires: { domains: { library: "^1.0.0" }, contributions: { commands: "^1.1.0", agentTools: "^1.1.0" } } }, "0.5.4", disposables,
  { moduleUrl: new URL("./virtual-removal-probe.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  bookId = parseProbeToast((await command("create").run())!.toast!).bookId;
  await flushLocalKV();
  return { dataDir, ...(await inspectVirtualRemovalProbe()) };
}

export async function inspectVirtualRemovalProbe() {
  await isolated();
  if (!bookId) throw Error("Probe not started");
  return { bookId, bookExists: !!await library.queries.books.get(bookId), binding: getVirtualBookBinding(bookId) };
}

export async function removeVirtualRemovalProbe(actor: "plugin" | "agent") {
  await isolated();
  let failure: { code?: string; message: string } | undefined;
  try {
    if (actor === "plugin") await command("remove").run();
    else {
      const tool = getPluginAgentTools({ kind: "global", threadId: id }).find(tool => tool.name === "plugin_capability_virtual_removal_remove");
      if (!tool) throw Error("Probe Agent tool missing");
      await tool.execute("removal-probe", {});
    }
  } catch (error) { failure = { code: errorCode(error), message: String(error) }; }
  return { actor, completed: !failure, failure, ...(await inspectVirtualRemovalProbe()) };
}

/** Remove database failure-injection triggers before calling cleanup. */
export async function cleanupVirtualRemovalProbe() {
  await isolated();
  if (bookId) await command("remove").run();
  try { await worker?.terminate(); }
  finally { for (const disposable of disposables.reverse()) disposable.dispose(); worker = undefined; disposables = []; }
  return { contributions: inspectContributions(id).length, ...(await inspectVirtualRemovalProbe()) };
}
