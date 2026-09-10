import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { Id } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createLibraryDomain, getExtractedChapters } from "../../../../domain/library";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildGraphTools } from "../../../../../../../packages/agent/src/tools/graph-tools";
import { buildMemoryTools } from "../../../../../../../packages/agent/src/tools/memory-tools";
import { createAgentTurnState } from "../../../../../../../packages/agent/src/tools/turn-state";
import { headerActionsAtom, pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { runPluginContribution } from "../../lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import manifest from "../../../../../../../plugins/memory-desk/manifest.json";

const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [], memoryIds: string[] = [];
let bookId: string | undefined, marker: string | undefined;
const library = createLibraryDomain("user");
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
async function start(declaration: PluginManifest, moduleUrl: string) {
  const worker = await startPluginWorker(declaration, "0.5.4", owned, { moduleUrl });
  workers.set(declaration.id, worker); await worker.checkHealth(); worker.promote();
}
export async function prepareMemoryDomainProbe() {
  const path = await isolated(); if (bookId || workers.size) throw Error("Probe already active");
  marker = `Memory Domain Probe ${crypto.randomUUID()}`;
  const body = ["Ada", "Ben", "Hidden"].map((name, index) => `<section id="chapter${index}"><title><p>Chapter ${index + 1}</p></title><p>${name} appears in this synthetic reading test. This chapter supplies a stable source identity for a controlled graph, not real model inference. ${"Reading evidence. ".repeat(40)}</p></section>`).join("");
  const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>${marker}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-10</date><id>${crypto.randomUUID()}</id><version>1.0</version></document-info></description><body>${body}</body></FictionBook>`;
  bookId = (await library.commands.books.importBook({ fileName: `${marker}.fb2`, data: new TextEncoder().encode(xml) })).id;
  const chapters = await getExtractedChapters(bookId);
  if (chapters.length !== 3) throw Error(`Expected three chapters, got ${chapters.length}`);
  await commitDomainEvents({ type: "book.narrativityClassified", payload: { bookId: bookId as Id, narrativity: "narrative" }, origin: "user" });
  for (const [index, chapter] of chapters.entries()) await commitDomainEvents({ type: "book.chapterDigested", origin: "agent", payload: {
    bookId: bookId as Id, chapterIndex: index, chapterHref: chapter.hrefs?.[0], summary: `Synthetic chapter ${index + 1}: ${["Ada", "Ben", "Hidden"][index]}`,
    characters: [{ name: ["Ada", "Ben", "Hidden"][index], ...(index === 2 ? { aliases: ["Ada"], note: "Secret future identity" } : {}) }],
    relations: index === 1 ? [{ from: "Ada", kind: "knows", to: "Ben" }] : [], digestVersion: 2, flavor: "narrative",
  } });
  await commitDomainEvents({ type: "book.progressed", origin: "user", payload: { bookId: bookId as Id, locator: "", chapterHref: chapters[2].hrefs?.[0], progressPercent: 60, status: "reading" } });
  for (const scope of ["user", "global", `book:${bookId}`] as const) {
    const memoryId = crypto.randomUUID(); memoryIds.push(memoryId);
    await commitDomainEvents({ type: "memory.promoted", origin: "agent", payload: { memoryId, kind: "preference", scope: scope.startsWith("book:") ? "book" : scope as "user" | "global", ...(scope.startsWith("book:") ? { bookId: bookId as Id } : {}), content: `${marker}: ${scope} evidence`, importance: 0.5 } });
  }
  for (const granted of [false, true]) await start({ id: `capability-memory-domain-${granted ? "read" : "empty"}`, name: "Memory domain probe", version: "1.0.0", schemaVersion: 1,
    description: JSON.stringify({ bookId, marker }), permissions: granted ? ["memory:read"] : [], requires: { domains: { memory: "^1.0.0" } } }, new URL("./memory-domain-probe.ts", import.meta.url).href);
  await start({ ...manifest, id: "capability-memory-domain-desk" } as PluginManifest, new URL("../../../../../../../plugins/memory-desk/dist/main.js", import.meta.url).href);
  return { path, bookId, marker, memoryIds, chapters: chapters.map((chapter, index) => ({ index, hrefs: chapter.hrefs })) };
}
export async function memoryDomainActor(role: "empty" | "read", action: string) {
  await isolated(); const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-memory-domain-${role}` && c.id === action);
  if (!command) throw Error("Missing command"); return parseProbeToast((await command.run())!.toast!) as unknown;
}
export async function memoryDomainHeaderOwners() {
  await isolated();
  return getDefaultStore().get(headerActionsAtom).map(action => ({ pluginId: action.pluginId, id: action.id, surface: action.surface, title: action.title }));
}
export async function memoryDomainAgent(kind: "graph" | "memory", global = false) {
  await isolated(); if (!bookId) throw Error("Missing owned book");
  const scope = global ? { kind: "global" as const, threadId: "memory-domain-probe" } : { kind: "book" as const, bookId: bookId as Id };
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: 2 };
  const tool = (kind === "graph" ? buildGraphTools(scope, buildRuntimeDeps(), state) : buildMemoryTools(scope, buildRuntimeDeps())).find(tool => tool.name === (kind === "graph" ? "query_book_graph" : "search_memory"))!;
  const result = await tool.execute("memory-domain-e2e", kind === "graph" ? { bookId } : { bookId, query: marker });
  return result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) as unknown : null;
}
export async function openMemoryDomainDesk() {
  await isolated(); const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === "capability-memory-domain-desk" && c.id === "open");
  if (!command) throw Error("Missing desk"); await runPluginContribution(command.pluginId, manifest.name, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function reclassifyMemoryDomainProbe(narrativity: "narrative" | "expository") {
  await isolated(); if (!bookId) throw Error("Missing owned book");
  await commitDomainEvents({ type: "book.narrativityClassified", origin: "user", payload: { bookId: bookId as Id, narrativity } });
}
export async function cleanupMemoryDomainProbe() {
  await isolated(); if (readingRuntime.snapshot().bookId === bookId) await readingRuntime.close();
  const actors = [...workers.keys()]; for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  for (const memoryId of memoryIds.splice(0)) await commitDomainEvents({ type: "memory.forgotten", origin: "user", payload: { memoryId, reason: "user" } });
  if (bookId) { await library.commands.books.remove(bookId); bookId = undefined; }
  return { ownedBooks: bookId ? 1 : 0, contributions: actors.reduce((sum, id) => sum + inspectContributions(id).length, 0) };
}
