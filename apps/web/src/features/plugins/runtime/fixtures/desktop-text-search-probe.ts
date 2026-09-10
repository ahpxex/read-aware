import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildBookTextTools } from "../../../../../../../packages/agent/src/tools/book-text-tools";
import { createAgentTurnState } from "../../../../../../../packages/agent/src/tools/turn-state";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { getBookTextSnapshot } from "../../../library/lib/book-text-store";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { seedTextStateBooks, extractRealTextProbe, cleanupTextStateProbe, startTextDeskProbe } from "./desktop-text-state-probe";

const workers = new Map<string, SandboxedPlugin>();
const disposables: PluginDisposable[] = [];
let books: Record<string, string> = {};
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}

export async function startTextSearchProbe() {
  await isolated();
  const seed = await seedTextStateBooks(); books = seed.books;
  await extractRealTextProbe(books.normal!);
  const coldBefore = await getBookTextSnapshot(books.short!);
  const actors: Record<string, unknown> = {};
  for (const actor of ["empty", "read", "write"] as const) {
    const id = `capability-search-${actor}`;
    const manifest: PluginManifest = { id, name: id, description: books.normal, schemaVersion: 1, version: "1.0.0",
      permissions: actor === "empty" ? [] : [actor === "read" ? "library:read" : "library:write"], requires: { domains: { library: "^1.4.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./text-search-probe.ts", import.meta.url).href });
    workers.set(id, worker); await worker.checkHealth(); worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "inspect")!;
    actors[actor] = parseProbeToast((await command.run())!.toast!);
  }
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: -1, readerChapterIndex: 0 };
  for (const kind of ["book", "global"] as const) {
    const scope = kind === "book" ? { kind, bookId: books.normal! } : { kind, threadId: "text-search-e2e" };
    const tool = buildBookTextTools(scope, buildRuntimeDeps(), state).find(tool => tool.name === "search_book_text")!;
    const result = await tool.execute("text-search-e2e", { queries: ["Text preparation probe"] });
    if (result.content[0]?.type !== "text") throw Error("Expected Agent text result");
    actors[`agent-${kind}`] = JSON.parse(result.content[0].text);
  }
  await startTextDeskProbe();
  return { ...seed, actors, coldBefore, coldAfter: await getBookTextSnapshot(books.short!) };
}

export async function cleanupTextSearchProbe() {
  await isolated(); const ids = [...workers.keys()];
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  const cleanup = await cleanupTextStateProbe(); books = {};
  return { ...cleanup, searchContributions: ids.reduce((count, id) => count + inspectContributions(id).length, 0) };
}
