import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createRoot, type Root } from "react-dom/client";
import { errorCode } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildDeleteBooksTool, buildListBookRemovalCleanupTool } from "../../../../../../../packages/agent/src/tools/delete-books";
import { interactionFromToolDetails } from "../../../../../../../packages/agent/src/tools/user-interaction";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { ChatInteractionPrompt } from "../../../ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../../ai/lib/chat-types";
import { getBookRecord, restoreLibraryBook, bookFileKey } from "../../../library/lib/library-db";
import { getDesktopBlob } from "../../../../platform/blob-store";
import { seedTextStateBooks, cleanupTextStateProbe } from "./desktop-text-state-probe";
import { inspectContributions } from "../../state/contribution-registry";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import libraryDeskManifest from "../../../../../../../plugins/library-desk/manifest.json";

const workers = new Map<string, SandboxedPlugin>(), disposables: PluginDisposable[] = [];
let ids: string[] = [], root: Root | undefined, surface: HTMLDivElement | undefined, abort: AbortController | undefined;
let sequence = 0, pending = false;
let agentResult: unknown;
const originals = new Map<string, { book: NonNullable<Awaited<ReturnType<typeof getBookRecord>>>; bytes: Uint8Array }>();
async function isolated() {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e app");
  return dataDir;
}
async function start(manifest: PluginManifest, moduleUrl: string) {
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl });
  workers.set(manifest.id, worker); await worker.checkHealth(); worker.promote();
}
const command = (actor: string, name: string) => {
  const entry = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === actor && command.id === name);
  if (!entry) throw Error("Missing batch probe command"); return entry;
};
export async function startBatchRemovalProbe() {
  const dataDir = await isolated(); if (workers.size) throw Error("Clean up previous batch probe first");
  const seed = await seedTextStateBooks(); ids = [seed.books.short!, seed.books.normal!];
  for (const id of ids) {
    const book = await getBookRecord(id), bytes = await getDesktopBlob(bookFileKey(id));
    if (!book || !bytes) throw Error("Missing seeded book"); originals.set(id, { book, bytes });
  }
  const permissions = await startRemovalRecoveryConsumers();
  return { ...seed, dataDir, ids, permissions };
}
export async function startRemovalRecoveryConsumers() {
  await isolated();
  if (workers.size) throw Error("Clean up previous batch probe first");
  const permissions: Record<string, unknown> = {};
  for (const role of ["empty", "read", "write"] as const) {
    const id = `capability-batch-${role}`;
    await start({ id, name: id, version: "1.0.0", schemaVersion: 1, description: JSON.stringify(ids),
      permissions: role === "empty" ? [] : [role === "read" ? "library:read" : "library:write"],
      requires: { domains: { library: "^1.6.0" } } }, new URL("./batch-removal-probe.ts", import.meta.url).href);
    permissions[role] = parseProbeToast((await command(id, "inspect").run())!.toast!);
  }
  await start(libraryDeskManifest as PluginManifest, new URL("../../../../../../../plugins/library-desk/dist/main.js", import.meta.url).href);
  return permissions;
}
export async function runPluginBatchRemoval(action: "remove" | "retry" | "invalid" | "cleanup-list" | "cleanup-next", actor = "capability-batch-write") {
  await isolated();
  try { return { result: parseProbeToast((await command(actor, action).run())!.toast!) }; }
  catch (error) { return { code: errorCode(error) }; }
}
export async function beginAgentBatchRemoval(cleanupOnly = false, cleanupIds?: string[]) {
  await isolated(); if (pending) throw Error("Agent request already pending");
  if (cleanupIds && !cleanupOnly) throw Error("Explicit IDs are only for cleanup recovery");
  root?.unmount(); surface?.remove();
  surface = document.createElement("div"); surface.setAttribute("data-batch-approval-probe", "true");
  Object.assign(surface.style, { position: "fixed", inset: "10% 15%", zIndex: "9999", overflow: "auto", background: "var(--ra-main-surface-color)", padding: "24px" });
  document.body.append(surface); root = createRoot(surface);
  abort = new AbortController(); pending = true; agentResult = { pending: true };
  const tool = buildDeleteBooksTool({ kind: "global", threadId: "capability-batch" }, buildRuntimeDeps());
  void tool.execute(`batch-${++sequence}`, { bookIds: [...(cleanupIds ?? ids)], cleanupOnly }, abort.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") root!.render(<ChatInteractionPrompt part={{
      type: "interaction", id: details.request.id, request: details.request, state: "pending",
    } satisfies ChatInteractionPart} />);
  }).then(result => { agentResult = result; }, error => { agentResult = { code: errorCode(error), name: error.name }; })
    .finally(() => { pending = false; root?.unmount(); root = undefined; surface?.remove(); surface = undefined; });
  return { started: true };
}
export function inspectAgentBatchRemoval() { return agentResult; }
export function cancelAgentBatchRemoval() { abort?.abort(); }
export async function inspectAgentRemovalCleanup(query = {}) {
  await isolated();
  return buildListBookRemovalCleanupTool(buildRuntimeDeps()).execute("cleanup-list", query);
}
export async function restoreBatchProbeBook() {
  await isolated(); const first = originals.get(ids[0]); if (!first) throw Error("No saved probe book");
  await restoreLibraryBook(first.book, first.bytes); return { restored: first.book.id };
}
export async function cleanupBatchRemovalProbe() {
  await isolated(); if (pending) throw Error("Settle Agent request before cleanup");
  for (const worker of workers.values()) await worker.terminate();
  const actors = [...workers.keys()]; workers.clear();
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  const cleanup = await cleanupTextStateProbe();
  originals.clear(); ids = [];
  return { ...cleanup, batchContributions: actors.reduce((sum, actor) => sum + inspectContributions(actor).length, 0) };
}
