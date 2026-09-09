import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { AppError, errorCode } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../../../domain/library";
import { getDesktopBlob, getDesktopBlobInfo, deleteDesktopBlob, putDesktopBlob } from "../../../../platform/blob-store";
import { ensureBookTextExtracted, deleteBookText, getBookTextSnapshot } from "../../../library/lib/book-text-store";
import { fileContentVersion, registerActiveBookContent, withBookContent } from "../../../library/lib/book-content-source";
import { retainBook } from "../../../reader/lib/book-lifetime";
import type { FoliateBook } from "../../../reader/lib/foliate-engine";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildBookTextTools } from "../../../../../../../packages/agent/src/tools/book-text-tools";
import textDeskManifest from "../../../../../../../plugins/text-desk/manifest.json";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";

const owned = new Set<string>();
const workers = new Map<string, SandboxedPlugin>();
const disposables: PluginDisposable[] = [];
const library = createLibraryDomain("user");
const prose = "Text preparation probe: this section contains enough text for the chapter index.";
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
async function own(bookId: string) {
  await isolated(); if (!owned.has(bookId)) throw Error("Only this probe's synthetic books may be changed");
}
async function start(manifest: PluginManifest, moduleUrl: string) {
  if (workers.has(manifest.id)) throw Error("Probe Worker already running");
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl });
  workers.set(manifest.id, worker); await worker.checkHealth(); worker.promote();
}

export async function seedTextStateBooks() {
  const dataDir = await isolated(); if (owned.size) throw Error("Clean up previous text probe first");
  const result: Record<string, string> = {};
  for (const kind of ["short", "normal"] as const) {
    const id = crypto.randomUUID();
    const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>Text State Probe ${kind} ${id}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware Tests</nickname></author><date>2026-09-09</date><id>${id}</id><version>1.0</version></document-info></description><body><section><p>${kind === "short" ? "Short text." : prose}</p></section></body></FictionBook>`;
    const imported = await library.commands.books.importBook({ fileName: `text-state-${id}.fb2`, data: new TextEncoder().encode(xml) });
    owned.add(imported.id); result[kind] = imported.id;
  }
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create(); pdf.setTitle(`Text State Probe blank ${crypto.randomUUID()}`); pdf.addPage([400, 600]);
  const blank = await library.commands.books.importBook({ fileName: "text-state-blank.pdf", data: await pdf.save() });
  owned.add(blank.id); result.blank = blank.id;
  return { dataDir, books: result };
}

export async function textStateActors(bookId: string) {
  await own(bookId);
  const output: Record<string, unknown> = {};
  for (const actor of ["empty", "read", "write"] as const) {
    const id = `capability-text-${actor}`;
    if (!workers.has(id)) await start({ id, name: id, description: bookId, schemaVersion: 1, version: "1.0.0",
      permissions: actor === "empty" ? [] : [actor === "read" ? "library:read" : "library:write"],
      requires: { domains: { library: "^1.2.0" } } }, new URL("./text-state-probe.ts", import.meta.url).href);
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "inspect");
    if (!command) throw Error("Probe command missing");
    output[actor] = JSON.parse((await command.run())!.toast!);
  }
  for (const scope of [{ kind: "book" as const, bookId }, { kind: "global" as const, threadId: "text-state-e2e" }]) {
    const tool = buildBookTextTools(scope, buildRuntimeDeps()).find(tool => tool.name === "get_book_text_status")!;
    const result = await tool.execute("text-state-e2e", scope.kind === "global" ? { bookId } : {});
    if (result.content[0]?.type !== "text") throw Error("Expected Agent text result");
    output[`agent-${scope.kind}`] = JSON.parse(result.content[0].text);
  }
  output.derivedBlob = await getDesktopBlobInfo(`booktext:${bookId}`);
  return output;
}

/** Injects only section read failures; source identity, persistence, Worker and Agent remain real. */
export async function partialTextStateProbe(bookId: string) {
  await own(bookId); await deleteBookText([bookId]);
  let broken = true;
  const calls = [0, 0, 0];
  const fake = { sections: calls.map((_, index) => ({ id: `section-${index}`, getText: async () => {
    calls[index]++; if (broken && index === 1) throw new AppError("fs/permission", "Injected section read failure"); return prose;
  } })) } as FoliateBook;
  const release = retainBook(fake);
  const unregister = registerActiveBookContent(bookId, fake, await fileContentVersion(bookId));
  try {
    let failure: string | undefined;
    try { await ensureBookTextExtracted(bookId, fake); } catch (error) { failure = errorCode(error); }
    const partial = await textStateActors(bookId);
    broken = false; await ensureBookTextExtracted(bookId, fake);
    return { failure, partial, ready: await textStateActors(bookId), calls };
  } finally { unregister(); await release(); await deleteBookText([bookId]); }
}

export async function extractRealTextProbe(bookId: string) {
  await own(bookId);
  const chapters = await withBookContent(bookId, undefined, undefined, async ({ book, contentVersion }) => {
    const unregister = registerActiveBookContent(bookId, book, contentVersion);
    try { return await ensureBookTextExtracted(bookId, book); }
    finally { unregister(); }
  });
  return { state: await getBookTextSnapshot(bookId), chapters };
}

export async function sourceInvalidationTextProbe(bookId: string) {
  await own(bookId);
  const bytes = await getDesktopBlob(`bookfile:${bookId}`); if (!bytes) throw Error("Source missing before probe");
  try {
    await deleteDesktopBlob(`bookfile:${bookId}`);
    const missing = await getBookTextSnapshot(bookId);
    const changed = new Uint8Array(bytes.length + 1); changed.set(bytes); changed[bytes.length] = 32;
    await putDesktopBlob(`bookfile:${bookId}`, changed);
    return { missing, changed: await getBookTextSnapshot(bookId) };
  } finally { await putDesktopBlob(`bookfile:${bookId}`, bytes); }
}

export async function startTextDeskProbe() {
  await isolated(); await start(textDeskManifest as PluginManifest, new URL("../../../../../../../plugins/text-desk/dist/main.js", import.meta.url).href);
  return { contributions: inspectContributions("text-desk").length };
}

export async function cleanupTextStateProbe() {
  await isolated();
  await buildRuntimeDeps().reader.close();
  const ids = [...workers.keys()];
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  for (const bookId of owned) { await deleteBookText([bookId]); await library.commands.books.remove(bookId); owned.delete(bookId); }
  return { remainingBooks: owned.size, contributions: ids.reduce((count, id) => count + inspectContributions(id).length, 0) };
}
