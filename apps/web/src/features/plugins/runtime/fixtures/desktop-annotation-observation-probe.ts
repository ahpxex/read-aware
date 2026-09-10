import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../../../domain/annotations";
import { createLibraryDomain } from "../../../../domain/library";
import { commitDomainEvents, mintEventRows } from "../../../../platform/domain-events";
import { createIpcSyncStore } from "../../../../platform/sync/sync-store";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildThreadTools } from "../../../../../../../packages/agent/src/tools/library-tools";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { runPluginContribution } from "../../lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import manifest from "../../../../../../../plugins/annotation-desk/manifest.json";

const domain = createAnnotationsDomain("user"), workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [];
let seed: { bookId: string; noteId: string; marker: string } | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
export async function prepareAnnotationObservationProbe() {
  await isolated(); if (seed || workers.size) throw Error("Clean prior fixture first");
  const bookId = crypto.randomUUID(), marker = `Annotation observation ${crypto.randomUUID()}`;
  // Metadata-only owned book: this probe does not claim import/render/navigation coverage.
  seed = { bookId, noteId: "", marker };
  await commitDomainEvents({ type: "book.imported", origin: "user", payload: { bookId, title: marker, format: "epub", fileName: "annotation-probe.epub", fileSize: 0, sourceBlobKey: `book:${bookId}` } });
  seed.noteId = (await domain.commands.createNote({ bookId, body: "Annotation observation: Initial note" })).id;
  for (const role of ["empty", "read", "write", "desk"] as const) {
    const declaration: PluginManifest = role === "desk" ? { ...manifest, id: "capability-annotation-observation-desk" } as PluginManifest
      : { id: `capability-annotation-observation-${role}`, name: "Annotation observation probe", version: "1.0.0", schemaVersion: 1,
        description: JSON.stringify(seed), permissions: role === "empty" ? [] : [`annotations:${role}`], requires: { domains: { annotations: "^2.0.0" } } };
    const url = role === "desk" ? new URL("../../../../../../../plugins/annotation-desk/dist/main.js", import.meta.url).href : new URL("./annotation-observation-probe.ts", import.meta.url).href;
    const worker = await startPluginWorker(declaration, "0.5.4", owned, { moduleUrl: url });
    workers.set(role, worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function annotationObservationActor(role: "empty" | "read" | "write", action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-annotation-observation-${role}` && c.id === action);
  if (!command) throw Error("Missing fixture command"); return parseProbeToast((await command.run())!.toast!);
}
export async function changeAnnotationObservation(kind: "user" | "remote" | "remove") {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  if (kind === "remote") return createIpcSyncStore().applyRemote(await mintEventRows([{ type: "note.updated", origin: "user", payload: { noteId: seed.noteId, body: "Annotation observation: Remote changed" } }]));
  const snapshot = (await domain.queries.inspect(seed.noteId))!;
  return domain.commands.applyChanges([{ annotationId: seed.noteId, expectedRevision: snapshot.revision,
    ...(kind === "remove" ? { op: "remove", kind: "note" } as const : { op: "updateNote", body: "Annotation observation: User changed" } as const) }]);
}
export async function annotationObservationAgent() {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  const tool = buildThreadTools({ kind: "book", bookId: seed.bookId }, buildRuntimeDeps()).find(t => t.name === "get_annotations")!;
  const result = await tool.execute("annotation-observation", { annotationId: seed.noteId });
  return result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : null;
}
export async function openAnnotationObservationDesk() {
  await isolated(); const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === "capability-annotation-observation-desk" && c.id === "open");
  if (!command) throw Error("Missing compiled desk");
  await runPluginContribution(command.pluginId, manifest.name, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function retireAnnotationObserver() {
  await isolated(); await workers.get("read")?.terminate(); workers.delete("read");
  return inspectContributions("capability-annotation-observation-read").length;
}
export async function cleanupAnnotationObservationProbe() {
  await isolated(); for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const item of owned.splice(0).reverse()) item.dispose();
  if (seed) {
    const library = createLibraryDomain("user");
    if (await library.queries.books.get(seed.bookId)) await library.commands.books.remove(seed.bookId);
    await library.commands.books.retryRemovalCleanup([seed.bookId]);
  }
  seed = undefined;
  return { ownedBooks: 0, contributions: ["empty", "read", "write", "desk"].reduce((n, role) => n + inspectContributions(`capability-annotation-observation-${role}`).length, 0) };
}
