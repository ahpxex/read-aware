import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { HostCommandRequest, PluginDisposable, PluginManifest, WorkspaceTarget } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../../../domain/library";
import { workspace } from "../../../../services/workspace";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildAgentTools } from "../../../../../../../packages/agent/src/tools/registry";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { runPluginContribution } from "../../lib/run-result";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import manifest from "../../../../../../../plugins/library-desk/manifest.json";

const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [], books: string[] = [];
let collectionId: string | undefined;
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
export async function prepareWorkspaceProbe() {
  const path = await isolated(); if (workers.size || books.length || collectionId) throw Error("Probe already active");
  collectionId = (await library.commands.collections.create("Workspace Probe Collection")).id;
  for (let n = 0; n < 2; n++) {
    const id = crypto.randomUUID();
    const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>Workspace Probe ${n} ${id}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware Tests</nickname></author><date>2026-09-09</date><id>${id}</id><version>1.0</version></document-info></description><body><section><p>This synthetic book verifies workspace navigation and reading handoff.</p></section></body></FictionBook>`;
    books.push((await library.commands.books.importBook({ fileName: `workspace-${id}.fb2`, data: new TextEncoder().encode(xml) })).id);
  }
  await library.commands.collections.assignBooks(books, collectionId);
  for (const role of ["empty", "read", "write", "reader"] as const) await start({ id: `capability-workspace-${role}`, name: `Workspace ${role}`, version: "1.0.0", schemaVersion: 1,
    description: JSON.stringify({ collectionId, bookIds: books }),
    permissions: role === "empty" ? [] : role === "read" ? ["library:read"] : role === "write" ? ["library:write"] : ["library:write", "reading:write"],
    ...(role === "reader" ? { settingsAccess: { read: ["shelf.*"], write: ["shelf.*"] } } : {}),
    requires: { services: { ui: "^1.6.0" }, domains: { library: "^1.6.0", reading: "^2.0.0" } } }, new URL("./workspace-probe.ts", import.meta.url).href);
  await start({ ...manifest, id: "capability-workspace-desk" } as PluginManifest, new URL("../../../../../../../plugins/library-desk/dist/main.js", import.meta.url).href);
  return { path, collectionId, bookIds: [...books] };
}
export async function workspaceActor(role: "empty" | "read" | "write" | "reader", action = "inspect") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-workspace-${role}` && c.id === action);
  if (!command) throw Error("Workspace command unavailable");
  return JSON.parse((await command.run())!.toast!) as unknown;
}
export async function agentWorkspace(name: "get_workspace" | "navigate_app", target?: WorkspaceTarget, scope: "book" | "global" = "global") {
  await isolated();
  const tools = buildAgentTools(scope === "book" ? { kind: "book", bookId: books[0] } : { kind: "global", threadId: "workspace-probe" }, buildRuntimeDeps());
  const result = await tools.find(tool => tool.name === name)!.execute("workspace-e2e", name === "navigate_app" ? { target } : {});
  if (result.content[0]?.type !== "text") throw Error("Expected Agent text");
  return JSON.parse(result.content[0].text) as unknown;
}
export async function agentHostCommand(request?: HostCommandRequest, scope: "book" | "global" = "global") {
  await isolated();
  const tools = buildAgentTools(scope === "book" ? { kind: "book", bookId: books[0] } : { kind: "global", threadId: "workspace-probe" }, buildRuntimeDeps());
  const result = await tools.find(tool => tool.name === (request ? "execute_host_command" : "list_host_commands"))!.execute("host-command-e2e", request ?? {});
  if (result.content[0]?.type !== "text") throw Error("Expected Agent text");
  return JSON.parse(result.content[0].text) as unknown;
}
export async function workspaceProbeState() { return { path: await isolated(), state: workspace.snapshot(), books: await library.queries.books.list(), collectionId }; }
export async function openWorkspaceBook() { await isolated(); return buildRuntimeDeps().reader.openBook(books[0]); }
export async function openWorkspaceDesk() {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === "capability-workspace-desk" && c.id === "open");
  if (!command) throw Error("Desk command unavailable");
  await runPluginContribution(command.pluginId, manifest.name, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function moveWorkspaceBook() { await isolated(); await library.commands.collections.assignBooks([books[0]], null); }
export async function cleanupWorkspaceProbe() {
  await isolated(); await buildRuntimeDeps().reader.close();
  const actors = [...workers.keys()];
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const resource of owned.splice(0).reverse()) resource.dispose();
  for (const id of [...books]) { await library.commands.books.remove(id); books.splice(books.indexOf(id), 1); }
  if (collectionId) { await library.commands.collections.remove(collectionId); collectionId = undefined; }
  return { ownedBooks: books.length, contributions: actors.reduce((sum, id) => sum + inspectContributions(id).length, 0) };
}
