import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { BookTextRange, PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../src/domain/library";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildNavigationTools } from "../../../../packages/agent/src/tools/navigation-tools";
import { createAgentTurnState } from "../../../../packages/agent/src/tools/turn-state";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import textDeskManifest from "../../../../plugins/text-desk/manifest.json";

const owned: string[] = [], disposables: PluginDisposable[] = [], workers: SandboxedPlugin[] = [], ids: string[] = [];
let seed: { bookId: string; pdfId: string } | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
async function start(manifest: PluginManifest, moduleUrl: string) {
  ids.push(manifest.id);
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl });
  workers.push(worker); await worker.checkHealth(); worker.promote();
}
function command(id: string) {
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === id);
  if (!command) throw Error("Missing probe command");
  return command;
}
export async function prepareRangeProbe() {
  await isolated(); if (owned.length || workers.length) throw Error("Clean previous range probe first");
  const key = crypto.randomUUID();
  const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><first-name>ReadAware</first-name><last-name>Tests</last-name></author><book-title>Range composition ${key}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-10</date><id>${key}</id><version>1.0</version></document-info></description><body><section id="first"><title><p>First passage</p></title><p>Before needle after. This is the visible test passage.</p></section><section id="later"><title><p>Later passage</p></title><p>Later needle spoiler. This is outside the first chapter fence.</p></section></body></FictionBook>`;
  const library = createLibraryDomain("user");
  const book = await library.commands.books.importBook({ fileName: `${key}.fb2`, data: new TextEncoder().encode(xml) });
  owned.push(book.id);
  const pdf = await PDFDocument.create(); pdf.setTitle(`Range PDF ${key}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([600, 800]).drawText("First needle here; second needle there", { font, x: 50, y: 700, size: 16 });
  pdf.addPage([600, 800]).drawText("Later needle spoiler", { font, x: 50, y: 700, size: 16 });
  const pdfBook = await library.commands.books.importBook({ fileName: `${key}.pdf`, data: await pdf.save() });
  owned.push(pdfBook.id); seed = { bookId: book.id, pdfId: pdfBook.id };
  for (const permission of ["none", "read", "write"] as const) await start({ id: `capability-range-${permission}`, name: "Range probe", version: "1.0.0", schemaVersion: 1,
    description: JSON.stringify(seed), permissions: permission === "none" ? [] : [`library:${permission}`],
    requires: permission === "none" ? {} : { domains: { library: "^1.7.0" } } }, new URL("./range-probe.ts", import.meta.url).href);
  await start({ ...textDeskManifest, id: "capability-range-desk" } as PluginManifest, new URL("../../../../plugins/text-desk/dist/main.js", import.meta.url).href);
  return seed;
}
export async function runRangeProbe() {
  await isolated(); if (!seed) throw Error("Prepare first");
  const deps = buildRuntimeDeps();
  const before = await deps.reader.getSession();
  const worker: Record<string, unknown> = {};
  for (const permission of ["none", "read", "write"]) worker[permission] = parseProbeToast((await command(`capability-range-${permission}`).run())!.toast!);
  const library = createLibraryDomain("agent");
  const found = await library.queries.books.searchLocations({ bookId: seed.bookId, query: "needle" });
  const first = found.hits[0].range, later = found.hits.at(-1)!.range;
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const scope = { kind: "book" as const, bookId: seed.bookId };
  const tool = buildNavigationTools(scope, deps, state).find(t => t.name === "read_book_range")!;
  const call = async (range: BookTextRange, confirmSpoiler?: boolean) => {
    try {
      const result = await tool.execute("range-probe", { range, confirmSpoiler });
      return result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : result;
    } catch (error) { return { code: error && typeof error === "object" && "code" in error ? error.code : "tool-denied" }; }
  };
  const agent = { first: await call(first), laterDenied: await call(later), selfGrant: await call(later, true), approved: null as unknown };
  state.spoilerPermissionGranted = true; agent.approved = await call(later, true);
  const globalTool = buildNavigationTools({ kind: "global", threadId: "range-probe" }, deps).find(t => t.name === "read_book_range")!;
  const global = await globalTool.execute("range-global", { range: first });
  const abort = new AbortController(); abort.abort();
  let cancelled: unknown;
  try { await library.queries.books.readRange({ range: first }, abort.signal); cancelled = "unexpected-success"; }
  catch (error) { cancelled = error instanceof Error ? error.name : "unknown"; }
  return { seed, worker, agent, global, cancelled, before, after: await deps.reader.getSession() };
}
export async function openRangeDesk() {
  await isolated(); const entry = command("capability-range-desk");
  await runPluginContribution(entry.pluginId, "Text Desk", entry.run, { presentation: "dialog", owner: entry.run });
}
export async function cleanupRangeProbe() {
  await isolated();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const item of disposables.splice(0).reverse()) item.dispose();
  await buildRuntimeDeps().reader.close();
  const library = createLibraryDomain("user");
  for (const bookId of owned) {
    if (await library.queries.books.get(bookId)) await library.commands.books.remove(bookId);
    await library.commands.books.retryRemovalCleanup([bookId]);
  }
  const result = { removed: [...owned], contributions: ids.map(id => [id, inspectContributions(id).length]) };
  owned.splice(0); ids.splice(0); seed = undefined; return result;
}
