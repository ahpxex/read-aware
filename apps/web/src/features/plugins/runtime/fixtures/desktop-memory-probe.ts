import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest, PluginFormView } from "@read-aware/plugin-types";
import type { Id } from "@read-aware/core";
import manifest from "../../../../../../../plugins/reading-goals/manifest.json";
import { buildMemoryTools } from "../../../../../../../packages/agent/src/tools/memory-tools";
import { createLibraryDomain } from "../../../../domain/library";
import { createReadingDomain } from "../../../../domain/reading";
import { localKV } from "../../../../platform/local-store";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { getAgentRuntime, discardAgentThread } from "../../../ai/agent/agent-runtime";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker } from "../plugin-worker-host";
import { pluginDocsDelete, pluginDocsGet } from "../plugin-backend";

const bookKey = "capability-memory-probe.book";
const disposables: PluginDisposable[] = [];
let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
async function assertIsolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
}
function bookId(): Id {
  const id = localKV.getItem(bookKey);
  if (!id) throw new Error("Memory probe book unavailable");
  return id as Id;
}
export async function prepareMemoryProbe() {
  await assertIsolated();
  if (localKV.getItem(bookKey)) throw new Error("Clean up previous memory probe first");
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>Memory Policy Probe</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-09</date><id>memory-policy-${crypto.randomUUID()}</id><version>1</version></document-info></description><body><section id="one"><title><p>Reading goals</p></title><p>Memory policy probe content. This is synthetic text, not a user book.</p></section></body></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: "memory-policy-probe.fb2", data: new TextEncoder().encode(source) });
  await localKV.setItemAsync(bookKey, book.id);
  worker = await startPluginWorker(manifest as PluginManifest, "0.5.4", disposables, { moduleUrl: new URL("../../../../../../../plugins/reading-goals/src/index.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  await createReadingDomain("agent").commands.openBook(book.id);
  return { bookId: book.id, contributions: inspectContributions("reading-goals").length };
}
async function goalForms(): Promise<PluginFormView[]> {
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === "reading-goals" && command.id === "open");
  const result = await command?.run();
  if (!result || result.view?.kind !== "blocks") throw new Error("Reading Goals unavailable");
  return result.view.blocks.filter(block => block.kind === "form");
}
export async function saveProbeGoal(text = "Memory policy probe goal: compare the evidence", suggestMemory = true) {
  await assertIsolated();
  const [form] = await goalForms();
  await form!.onSubmit({ goal: text, suggestMemory });
  return memoryProbeSnapshot();
}
export async function pluginMemoryPolicy(enabled: boolean) {
  await assertIsolated();
  const [, form] = await goalForms();
  try { await form!.onSubmit({ enabled }); return { status: "committed" }; }
  catch (error) { return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null }; }
}
export async function memoryProbeSnapshot() {
  await assertIsolated();
  const deps = buildRuntimeDeps();
  return { memories: await deps.memory.searchMemories({ scopes: [`book:${bookId()}`] }),
    insights: await deps.conversations.getInsights(`book:${bookId()}`),
    turns: (await deps.conversations.load(`book:${bookId()}`)).length,
    goal: await pluginDocsGet("reading-goals", "goals", bookId()) };
}
export async function memoryProbeTurn() {
  await assertIsolated();
  const runtime = getAgentRuntime();
  if (!runtime) throw new Error("Configure controlled inference first");
  for await (const _ of runtime.sendTurn({ kind: "book", bookId: bookId() }, { text: "Memory policy probe question" })) { /* drain actual product turn */ }
  await runtime.flushBackgroundWork();
  return memoryProbeSnapshot();
}
export async function explicitProbeMemory() {
  await assertIsolated();
  const tool = buildMemoryTools({ kind: "book", bookId: bookId() }, buildRuntimeDeps()).find(tool => tool.name === "remember")!;
  try { await tool.execute("memory-probe", { scope: "book", kind: "fact", content: "Memory policy probe explicit fact" }); return { status: "completed" }; }
  catch (error) { return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null }; }
}
export async function cleanupMemoryProbe() {
  await assertIsolated();
  await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  const id = localKV.getItem(bookKey);
  if (id) {
    const library = createLibraryDomain("user");
    const book = await library.queries.books.get(id);
    if (book && book.title !== "Memory Policy Probe") throw new Error("Memory probe identity mismatch");
    await createReadingDomain("user").commands.close();
    const deps = buildRuntimeDeps();
    const memories = await deps.memory.searchMemories({ scopes: [`book:${id}`], limit: 100 });
    for (const memory of memories) await commitDomainEvents({ type: "memory.forgotten", payload: { memoryId: memory.id, reason: "user" }, origin: "user" });
    await discardAgentThread("book", id);
    await localKV.removeItemAsync(`read-aware-plugin.reading-goals.goal:${id}`);
    await pluginDocsDelete("reading-goals", "goals", id);
    if (book) await library.commands.books.remove(id);
    await localKV.removeItemAsync(bookKey);
  }
  return { contributions: inspectContributions("reading-goals").length };
}
