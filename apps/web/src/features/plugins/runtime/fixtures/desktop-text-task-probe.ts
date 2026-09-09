import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { BookTextTaskSnapshot } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildBookTextTools } from "../../../../../../../packages/agent/src/tools/book-text-tools";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { fileContentVersion, registerActiveBookContent } from "../../../library/lib/book-content-source";
import { deleteBookText, ensureBookTextExtracted } from "../../../library/lib/book-text-store";
import { getDesktopBlobInfo } from "../../../../platform/blob-store";
import { retainBook } from "../../../reader/lib/book-lifetime";
import type { FoliateBook } from "../../../reader/lib/foliate-engine";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { seedTextStateBooks, cleanupTextStateProbe, startTextDeskProbe } from "./desktop-text-state-probe";

const workers = new Map<string, { worker: SandboxedPlugin; disposables: PluginDisposable[] }>();
let books: Record<string, string> = {};
let releaseBarrier: (() => void) | undefined;
let unbind: (() => void) | undefined;
let releaseBook: (() => Promise<void>) | undefined;
let reads = 0;
const assert = (value: unknown, message: string) => { if (!value) throw Error(message); };
async function isolated() {
  const path = await appDataDir();
  assert(path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e"), "Isolated capability app required");
  return path;
}
async function until(check: () => Promise<boolean> | boolean) {
  const start = Date.now();
  while (!await check()) {
    if (Date.now() - start > 12_000) throw Error("Probe condition timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function actor(id: string, permission?: "library:read" | "library:write", foreignTask?: string, activationProbe = false) {
  const disposables: PluginDisposable[] = [];
  const manifest: PluginManifest = { id, name: id, version: "1.0.0", schemaVersion: 1,
    description: JSON.stringify({ bookId: books.normal, foreignTask, activationProbe }), permissions: permission ? [permission] : [], requires: { domains: { library: "^1.3.0" } } };
  try {
    const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./text-task-probe.ts", import.meta.url).href });
    workers.set(id, { worker, disposables }); await worker.checkHealth(); worker.promote();
  } catch (error) {
    await stop(id); for (const disposable of disposables) disposable.dispose(); throw error;
  }
}
async function stop(id: string) {
  const actor = workers.get(id); if (!actor) return;
  await actor.worker.terminate(); for (const disposable of actor.disposables.reverse()) disposable.dispose(); workers.delete(id);
}
export async function textTaskCommand(id: string, action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === action);
  if (!command) throw Error("Probe command missing");
  return JSON.parse((await command.run())!.toast!);
}
async function settled(id: string): Promise<BookTextTaskSnapshot> {
  let result: BookTextTaskSnapshot;
  await until(async () => { result = await textTaskCommand(id, "get"); return !["queued", "running"].includes(result.status); });
  return result!;
}

/** A held section is the only injected behavior; source lookup, task ownership and blob writes remain native. */
async function holdExtraction() {
  await deleteBookText([books.normal!]); reads = 0;
  const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
  const fake = { sections: [0, 1, 2].map(index => ({ id: `task-section-${index}`, getText: async () => {
    reads++; if (index === 0) await barrier;
    return `Section ${index}: this is sufficient text to build an actual derived chapter in the native repository.`;
  } })) } as FoliateBook;
  releaseBook = retainBook(fake);
  unbind = registerActiveBookContent(books.normal!, fake, await fileContentVersion(books.normal!));
}
async function releaseExtraction() {
  releaseBarrier?.(); releaseBarrier = undefined;
  unbind?.(); unbind = undefined;
  await releaseBook?.(); releaseBook = undefined;
}

export async function runTextTaskProbe() {
  const dataDir = await isolated(); assert(!Object.keys(books).length, "Clean up previous probe first");
  books = (await seedTextStateBooks()).books;
  let activationRejected = false;
  try { await actor("capability-task-activation", "library:write", undefined, true); }
  catch (error) { activationRejected = error instanceof Error && error.message.includes("unavailable while plugin is activating"); }
  assert(activationRejected && inspectContributions("capability-task-activation").length === 0, "Activation must reject mutation and roll back");
  const a = "capability-task-a", b = "capability-task-b", read = "capability-task-read", empty = "capability-task-empty";
  await actor(a, "library:write"); await actor(b, "library:write"); await actor(read, "library:read"); await actor(empty);
  const permissions = { empty: await textTaskCommand(empty, "inspect"), read: await textTaskCommand(read, "inspect"), write: await textTaskCommand(a, "inspect") };
  assert(!permissions.empty.library && permissions.read.library && !permissions.read.write && permissions.write.write, "Permission shape mismatch");
  assert(await getDesktopBlobInfo(`booktext:${books.normal}`) === null, "Activation unexpectedly prepared text");
  await holdExtraction();
  const first = await textTaskCommand(a, "start"); await until(() => reads === 1);
  const second = await textTaskCommand(b, "start");
  // Revision 1 is the preflight receipt and may contain another job's snapshot.
  // Wait for the repository's lease callback before claiming shared extraction.
  await until(async () => (await textTaskCommand(b, "events")).some((e: BookTextTaskSnapshot) => e.revision >= 2 && e.textState.status === "preparing"));
  const cancelled = await textTaskCommand(a, "cancel");
  assert(cancelled.status === "cancelled", "Actor A cancellation failed");
  assert((await textTaskCommand(b, "get")).status === "running", "Cancelling A stopped B");
  releaseBarrier!(); const completed = await settled(b);
  assert(completed.status === "completed" && reads === 3, "Shared extraction must read each section only once");
  await until(async () => (await textTaskCommand(b, "events")).at(-1)?.status === "completed");
  const events = await textTaskCommand(b, "events");
  assert(events.every((entry: BookTextTaskSnapshot, i: number) => !i || entry.revision > events[i - 1].revision), "Nonmonotonic progress");
  await actor("capability-task-foreign", "library:read", second.taskId);
  const foreign = await textTaskCommand("capability-task-foreign", "foreign");
  assert(foreign.errorCode === "library/text-task-not-found", "Another actor read a private task");
  await stop(b); await actor(b, "library:write", second.taskId);
  const retired = await textTaskCommand(b, "foreign");
  assert(retired.errorCode === "library/text-task-not-found", "A new generation revived old tasks");
  await releaseExtraction();

  await holdExtraction();
  await textTaskCommand(a, "start"); await until(() => reads === 1);
  const lastCancelled = await textTaskCommand(a, "cancel");
  releaseBarrier!(); await releaseExtraction();
  assert(lastCancelled.status === "cancelled", "Last request not cancelled");
  assert(await getDesktopBlobInfo(`booktext:${books.normal}`) === null, "Late cancelled work published an index");

  await holdExtraction();
  const host = ensureBookTextExtracted(books.normal!); await until(() => reads === 1);
  await textTaskCommand(a, "rebuild"); const busy = await settled(a);
  assert(busy.status === "failed" && busy.errorCode === "library/text-busy", "Rebuild interrupted host-owned work");
  releaseBarrier!(); await host; await releaseExtraction();

  await holdExtraction();
  await textTaskCommand(a, "start"); await until(() => reads === 1);
  await textTaskCommand(b, "start");
  await until(async () => (await textTaskCommand(b, "events")).some((event: BookTextTaskSnapshot) => event.revision >= 2));
  const unsubscribed = await textTaskCommand(b, "unsubscribe");
  await stop(a); releaseBarrier!();
  const survivor = await settled(b);
  assert(survivor.status === "completed" && reads === 3, "Worker shutdown interrupted another actor");
  assert((await textTaskCommand(b, "events")).length === unsubscribed.count, "Disposed observation kept delivering");
  await releaseExtraction(); await actor(a, "library:write");

  await holdExtraction();
  const stoppedReceipt = await textTaskCommand(b, "start"); await until(() => reads === 1);
  await stop(b); releaseBarrier!(); await releaseExtraction();
  assert(await getDesktopBlobInfo(`booktext:${books.normal}`) === null, "Last Worker shutdown published cancelled work");
  await actor(b, "library:write", stoppedReceipt.taskId);
  assert((await textTaskCommand(b, "foreign")).errorCode === "library/text-task-not-found", "Shutdown task survived activation");

  const agent: Record<string, unknown> = {};
  for (const scope of [{ kind: "book" as const, bookId: books.short! }, { kind: "global" as const, threadId: "text-tasks" }]) {
    const tools = buildBookTextTools(scope, buildRuntimeDeps());
    const call = async (name: string, input: Record<string, unknown>) => {
      const result = await tools.find(tool => tool.name === name)!.execute("probe", input);
      if (result.content[0]?.type !== "text") throw Error("Expected Agent text"); return JSON.parse(result.content[0].text);
    };
    const receipt = await call("prepare_book_text", { bookId: books.short, rebuild: true });
    let done: BookTextTaskSnapshot;
    await until(async () => { done = await call("get_book_text_tasks", { bookId: books.short, taskId: receipt.taskId }); return done.status !== "running" && done.status !== "queued"; });
    assert(done!.status === "completed" && done!.textState.text === "available" && done!.textState.chapterCount === 0, "Agent short-text extraction failed");
    agent[scope.kind] = { receipt, done: done!, cancel: await call("cancel_book_text_task", { bookId: books.short, taskId: receipt.taskId }),
      list: await call("get_book_text_tasks", { bookId: books.short }) };
  }
  await textTaskCommand(b, "rebuild"); const realRebuild = await settled(b);
  assert(realRebuild.status === "completed" && realRebuild.textState.chapterCount === 1, "Real FB2 rebuild failed");
  await startTextDeskProbe();
  return { dataDir, books, permissions, activationRejected, first, second, cancelled, completed, events, foreign, retired, lastCancelled, busy,
    shutdown: { survivor, unsubscribed, stoppedReceipt, lateBlob: null }, agent, realRebuild };
}

export async function cleanupTextTaskProbe() {
  await isolated();
  const ids = [...workers.keys()]; for (const id of ids) await stop(id);
  await releaseExtraction();
  const cleanup = await cleanupTextStateProbe(); books = {};
  return { ...cleanup, taskContributions: ids.map(id => ({ id, count: inspectContributions(id).length })) };
}
