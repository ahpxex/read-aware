import { createRoot, type Root } from "react-dom/client";
import { getDefaultStore } from "jotai";
import type { DigestFlavor } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe, openMemoryDomainDesk } from "./desktop-memory-domain-probe";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildBookClassificationTool } from "../../../../../../../packages/agent/src/tools/book-classification-tool";
import { interactionFromToolDetails } from "../../../../../../../packages/agent/src/tools/user-interaction";
import { ChatInteractionPrompt } from "../../../ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../../ai/lib/chat-types";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
const workers: SandboxedPlugin[] = [], owned: PluginDisposable[] = [];
let root: Root | undefined, container: HTMLElement | undefined, call: AbortController | undefined;
let task: Promise<void> | undefined, outcome: unknown, part: ChatInteractionPart | undefined;

export async function prepareClassificationPublicProbe() {
  seed = await prepareMemoryDomainProbe();
  for (const role of ["empty", "read", "write"] as const) {
    const manifest: PluginManifest = { id: `capability-classification-${role}`, name: "Classification probe", version: "1.0.0", schemaVersion: 1,
      description: JSON.stringify({ bookId: seed.bookId }), permissions: role === "empty" ? [] : [role === "read" ? "memory:read" : "memory:write"], requires: { domains: { memory: "^1.3.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./classification-domain-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function classificationActor(role: "empty" | "read" | "write", action: string) {
  if (!seed) throw Error("Prepare isolated probe first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-classification-${role}` && c.id === action);
  if (!command) throw Error("Missing probe command"); return JSON.parse((await command.run())!.toast!) as unknown;
}
export async function beginClassificationApproval(narrativity: DigestFlavor, global = false) {
  if (!seed || task) throw Error("Prepare isolated probe and finish previous approval first");
  const deps = buildRuntimeDeps(), snapshot = await deps.bookClassification.inspect(seed.bookId);
  if (!snapshot) throw Error("Missing owned book");
  container = document.createElement("div");
  container.dataset.classificationApprovalProbe = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "80px 24px auto", maxWidth: "640px", margin: "auto", background: "var(--color-paper, white)", padding: "16px", maxHeight: "80vh", overflow: "auto" });
  document.body.append(container); root = createRoot(container); call = new AbortController(); outcome = { status: "pending" };
  const scope = global ? { kind: "global" as const, threadId: "classification-probe" } : { kind: "book" as const, bookId: seed.bookId };
  task = buildBookClassificationTool(scope, deps).execute(crypto.randomUUID(), { action: "classify", bookId: seed.bookId, narrativity, expectedRevision: snapshot.revision }, call.signal,
    update => {
      const details = interactionFromToolDetails(update.details);
      if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: details.request, state: "pending" };
      if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
      if (part) root?.render(<ChatInteractionPrompt part={part} />);
    }).then(result => { outcome = { status: "done", result }; }, error => { outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }; });
  return { bookId: seed.bookId, expectedRevision: snapshot.revision };
}
export function classificationApprovalStatus() { return outcome; }
export async function endClassificationApproval() {
  call?.abort(); await task; task = undefined; call = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined; part = undefined;
  return outcome;
}
export { openMemoryDomainDesk };
export async function cleanupClassificationPublicProbe() {
  await endClassificationApproval();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const item of owned.splice(0).reverse()) item.dispose();
  const clean = await cleanupMemoryDomainProbe(); seed = undefined;
  return { ...clean, classificationContributions: ["empty", "read", "write"].reduce((sum, role) => sum + inspectContributions(`capability-classification-${role}`).length, 0) };
}
