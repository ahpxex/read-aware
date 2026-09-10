import { parseProbeToast } from "./probe-toast";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe, openMemoryDomainDesk, memoryDomainAgent } from "./desktop-memory-domain-probe";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { commitDomainEvents, mintEventRows } from "../../../../platform/domain-events";
import { createIpcSyncStore } from "../../../../platform/sync/sync-store";
import { inspectMemory, mutateMemory } from "../../../../domain/memory-management";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [];
export async function prepareMemoryObservationProbe() {
  seed = await prepareMemoryDomainProbe();
  for (const role of ["empty", "read", "write"] as const) {
    const manifest: PluginManifest = { id: `capability-memory-observation-${role}`, name: "Memory observation probe", version: "1.0.0", schemaVersion: 1,
      description: JSON.stringify({ bookId: seed.bookId, memoryId: seed.memoryIds[0], marker: seed.marker }),
      permissions: role === "empty" ? [] : [role === "read" ? "memory:read" : "memory:write"], requires: { domains: { memory: "^1.2.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./memory-observation-probe.ts", import.meta.url).href });
    workers.set(role, worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function memoryObservationActor(role: "empty" | "read" | "write", action: string) {
  if (!seed) throw Error("Prepare isolated observation probe first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-memory-observation-${role}` && c.id === action);
  if (!command) throw Error("Missing probe command"); return parseProbeToast((await command.run())!.toast!) as unknown;
}
export async function memoryObservationChange(kind: "user" | "remote" | "forget" | "early" | "late") {
  if (!seed) throw Error("Prepare isolated observation probe first");
  const memoryId = seed.memoryIds[0]!;
  if (kind === "early" || kind === "late") return commitDomainEvents({ type: "book.progressed", origin: "user", payload: {
    bookId: seed.bookId, chapterHref: seed.chapters[kind === "early" ? 0 : 2]!.hrefs?.[0], locator: "", progressPercent: kind === "early" ? 0 : 60, status: "reading",
  } });
  if (kind === "remote") return createIpcSyncStore().applyRemote(await mintEventRows([{ type: "memory.revised", origin: "user", payload: { memoryId, content: `${seed.marker}: Native remote revision` } }]));
  const snapshot = await inspectMemory(memoryId); if (!snapshot) throw Error("Missing owned memory");
  return mutateMemory(kind === "forget" ? { op: "forget", memoryId, expectedRevision: snapshot.revision }
    : { op: "correct", memoryId, expectedRevision: snapshot.revision, content: `${seed.marker}: Native user revision` }, "user");
}
export async function retireMemoryObserver() {
  await workers.get("read")?.terminate(); workers.delete("read");
  return inspectContributions("capability-memory-observation-read").length;
}
export { openMemoryDomainDesk, memoryDomainAgent };
export async function cleanupMemoryObservationProbe() {
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const item of owned.splice(0).reverse()) item.dispose();
  const clean = await cleanupMemoryDomainProbe(); seed = undefined;
  return { ...clean, observationContributions: ["empty", "read", "write"].reduce((sum, role) => sum + inspectContributions(`capability-memory-observation-${role}`).length, 0) };
}
