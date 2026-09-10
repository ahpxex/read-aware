import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../../../domain/library";
import { createAnnotationsDomain } from "../../../../domain/annotations";
import { createIpcSyncStore } from "../../../../platform/sync/sync-store";
import { mintEventRows } from "../../../../platform/domain-events";
import { listPendingReadingSessions } from "../../../../platform/reading-session";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildThreadTools } from "../../../../../../../packages/agent/src/tools/library-tools";
import { buildReaderTools } from "../../../../../../../packages/agent/src/tools/reader-tools";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";

const id = "capability-reader-annotations", owned: string[] = [], disposables: PluginDisposable[] = [];
let worker: SandboxedPlugin | undefined, seed: { bookId: string; otherBookId: string; noteId: string; anchor: string; chapterHref: string } | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
async function importBook(label: string) {
  const key = crypto.randomUUID();
  const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><first-name>ReadAware</first-name><last-name>Tests</last-name></author><book-title>${label} ${key}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-10</date><id>${key}</id><version>1.0</version></document-info></description><body><section id="first"><title><p>Shared annotations</p></title><p>Shared annotation target. This passage belongs to an isolated native test book.</p><p>Changes made by an authorized plugin or agent should appear without reopening the reader.</p></section></body></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: `${key}.fb2`, data: new TextEncoder().encode(xml) });
  owned.push(book.id); return book;
}
export async function prepareReaderAnnotationProbe() {
  await isolated(); if (owned.length || worker) throw Error("Clean previous fixture first");
  const book = await importBook("Native annotation observation"), other = await importBook("Other annotation scope");
  const deps = buildRuntimeDeps();
  await deps.reader.goTo({ bookId: book.id, fraction: 0 });
  const found = await createLibraryDomain("user").queries.books.searchLocations({ bookId: book.id, query: "Shared annotation target", matchCase: true });
  const location = found.hits[0]?.location;
  if (!location?.cfi) throw Error("Expected a host-issued CFI");
  const note = await createAnnotationsDomain("agent").commands.createNote({ bookId: book.id, body: "Initial native note",
    anchor: location.cfi, chapterHref: location.href, quotedText: "Shared annotation target" });
  seed = { bookId: book.id, otherBookId: other.id, noteId: note.id, anchor: location.cfi, chapterHref: location.href ?? "" };
  const manifest: PluginManifest = { id, name: "Reader annotation probe", schemaVersion: 1, version: "1.0.0", description: JSON.stringify(seed),
    permissions: ["annotations:write", "reading:write"], requires: { domains: { annotations: "^2.0.0", reading: "^2.0.0" } } };
  worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./reader-annotation-probe.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote(); return seed;
}
export async function readerAnnotationAction(action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === id && c.id === action);
  if (!command) throw Error("Missing fixture command");
  return parseProbeToast((await command.run())!.toast!);
}
export async function readerAnnotationRemote() {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  return createIpcSyncStore().applyRemote(await mintEventRows([{ type: "note.updated", origin: "user", payload: { noteId: seed.noteId, body: "Remote native note changed" } }]));
}
export async function readerAnnotationAgent() {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  const tool = buildThreadTools({ kind: "book", bookId: seed.bookId }, buildRuntimeDeps()).find(t => t.name === "get_annotations")!;
  const result = await tool.execute("native-annotation-read", {});
  return result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : null;
}
export async function switchReaderAnnotationBook(other: boolean) {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  return buildRuntimeDeps().reader.goTo({ bookId: other ? seed.otherBookId : seed.bookId, fraction: 0 });
}
export async function closeReaderAnnotationAgent() {
  await isolated(); if (!seed) throw Error("Prepare fixture first");
  const tool = buildReaderTools({ kind: "book", bookId: seed.bookId }, buildRuntimeDeps()).find(t => t.name === "navigate_reading")!;
  const result = await tool.execute("native-reading-retirement", { action: "close" });
  return result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : null;
}
export async function cleanupReaderAnnotationProbe() {
  await isolated(); await worker?.terminate(); worker = undefined;
  for (const item of disposables.splice(0).reverse()) item.dispose();
  await buildRuntimeDeps().reader.close();
  const pending = (await listPendingReadingSessions()).filter(bucket => owned.includes(bucket.bookId));
  if (pending.length) throw Error("Reading close acknowledged before owned buckets retired");
  const library = createLibraryDomain("user");
  for (const bookId of owned) {
    if (await library.queries.books.get(bookId)) await library.commands.books.remove(bookId);
    await library.commands.books.retryRemovalCleanup([bookId]);
  }
  owned.splice(0); seed = undefined;
  return { contributions: inspectContributions(id).length };
}
