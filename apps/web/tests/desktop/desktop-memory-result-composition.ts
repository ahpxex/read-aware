import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { Id } from "@read-aware/core";
import type { PluginDisposable, PluginManifest, PluginListView } from "@read-aware/plugin-types";
import goalManifest from "../../../../plugins/reading-goals/manifest.json";
import deskManifest from "../../../../plugins/memory-desk/manifest.json";
import { runMemoryBuild } from "../../../../packages/agent/src/memory/build-policy";
import { persistExtensionMemory } from "../../../../packages/agent/src/runtime/extension-memory";
import { buildMemoryTools } from "../../../../packages/agent/src/tools/memory-tools";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { commitDomainEvents } from "../../src/platform/domain-events";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginDocsDelete } from "../../src/features/plugins/runtime/plugin-backend";
import { getPluginMemoryCandidates } from "../../src/features/plugins/runtime/plugin-tools";

const goalId = "capability-memory-result-goals", deskId = "capability-memory-result-desk";
const workers = new Map<string, SandboxedPlugin>(), disposables: PluginDisposable[] = [];
let bookId: Id | undefined, marker = "";
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e profile required");
}
function ownedBook() { if (!bookId) throw Error("Prepare composition first"); return bookId; }
function command(id: string, name: string) {
  const item = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === name);
  if (!item) throw Error("Missing composition command"); return item;
}
async function start(id: string, manifest: PluginManifest, moduleUrl: string) {
  const worker = await startPluginWorker({ ...manifest, id }, "0.5.4", disposables, { moduleUrl });
  workers.set(id, worker); await worker.checkHealth(); worker.promote();
}
export async function prepareMemoryResultComposition() {
  await isolated(); if (bookId || workers.size) throw Error("Composition already prepared");
  marker = `Composition memory ${crypto.randomUUID()}`;
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>${marker}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-11</date><id>${crypto.randomUUID()}</id><version>1</version></document-info></description><body><section id="one"><title><p>Memory composition</p></title><p>Synthetic reading content for memory result and pagination tests.</p></section></body></FictionBook>`;
  bookId = (await createLibraryDomain("user").commands.books.importBook({ fileName: "memory-result.fb2", data: new TextEncoder().encode(source) })).id;
  await commitDomainEvents(...Array.from({ length: 105 }, (_, index) => ({ type: "memory.promoted" as const, origin: "agent" as const,
    payload: { memoryId: crypto.randomUUID(), kind: "fact" as const, scope: "book" as const, bookId: ownedBook(),
      content: `Composition memory item ${String(index + 1).padStart(3, "0")}`, importance: 0.5 } })));
  await start(goalId, goalManifest as PluginManifest, new URL("../../../../plugins/reading-goals/dist/main.js", import.meta.url).href);
  await start(deskId, deskManifest as PluginManifest, new URL("../../../../plugins/memory-desk/dist/main.js", import.meta.url).href);
  await createReadingDomain("agent").commands.openBook(ownedBook());
  return inspectMemoryResultComposition();
}
export async function inspectMemoryResultComposition() {
  await isolated();
  const rows = await buildRuntimeDeps().memory.listMemories();
  const own = rows.filter(row => row.scope === `book:${ownedBook()}`);
  return { bookId, marker, count: own.length, goalRows: own.filter(row => row.kind === "preference").map(row => ({ id: row.id, content: row.content })),
    versions: { goals: goalManifest.version, desk: deskManifest.version } };
}
export async function openMemoryResultGoal(status = false) {
  await isolated(); ownedBook(); const item = command(goalId, status ? "memory-status" : "open");
  await runPluginContribution(goalId, goalManifest.name, () => item.run(), { presentation: "dialog", owner: item.run });
}
/** Production candidate pipeline and native ports, without a model invocation or chat turn. */
export async function processMemoryResultGoal() {
  await isolated(); const id = ownedBook(), deps = buildRuntimeDeps(), scope = { kind: "book" as const, bookId: id };
  await runMemoryBuild(deps, async operation => {
    const candidates = await getPluginMemoryCandidates({ scope, userText: "Synthetic composition request", assistantText: "Synthetic answer", signal: operation.signal });
    if (candidates.length !== 1) throw Error(`Expected one owned goal candidate, got ${candidates.length}`);
    await persistExtensionMemory({ scope, sourceThreadKey: `book:${id}`, candidates,
      memory: deps.memory, operation, log: deps.log });
  });
  return inspectMemoryResultComposition();
}
export async function openMemoryResultPage() {
  await isolated(); const id = ownedBook(), item = command(deskId, "open");
  await runPluginContribution(deskId, deskManifest.name, async () => {
    const home = (await item.run())!.view as PluginListView;
    const books = (await home.items.find(item => item.id === "books")!.onSelect!())!.view as PluginListView;
    const book = (await books.items.find(item => item.id === id)!.onSelect!())!.view as PluginListView;
    return book.items.find(item => item.id === "memory")!.onSelect!();
  }, { presentation: "dialog", owner: item.run });
}
export async function memoryResultAgentPages() {
  await isolated();
  const tool = buildMemoryTools({ kind: "book", bookId: ownedBook() }, buildRuntimeDeps()).find(tool => tool.name === "search_memory")!;
  const ids: string[] = [], counts: number[] = [];
  let input: Record<string, unknown> = {};
  for (let i = 0; i < 20; i++) {
    const result = await tool.execute("memory-composition", input);
    if (result.content[0]?.type !== "text") throw Error("Expected page result");
    const page = JSON.parse(result.content[0].text) as import("@read-aware/core").MemoryPage;
    ids.push(...page.items.filter(row => row.scope === `book:${ownedBook()}`).map(row => row.id)); counts.push(page.items.length);
    if (page.nextOffset === null) return { counts, ownCount: ids.length, uniqueOwnCount: new Set(ids).size };
    input = { offset: page.nextOffset, expectedRevision: page.revision };
  }
  throw Error("Unexpected page count");
}
export async function cleanupMemoryResultComposition() {
  await isolated(); const id = ownedBook();
  if (readingRuntime.snapshot().bookId === id) await readingRuntime.close();
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  const rows = (await buildRuntimeDeps().memory.listMemories()).filter(row => row.scope === `book:${id}`);
  await commitDomainEvents(...rows.map(row => ({ type: "memory.forgotten" as const, origin: "user" as const, payload: { memoryId: row.id, reason: "user" as const } })));
  await pluginDocsDelete(goalId, "goals", id);
  await createLibraryDomain("user").commands.books.remove(id);
  const result = { ...await inspectMemoryResultComposition(), contributions: inspectContributions(goalId).length + inspectContributions(deskId).length,
    book: await createLibraryDomain("user").queries.books.get(id) };
  bookId = undefined; return result;
}
