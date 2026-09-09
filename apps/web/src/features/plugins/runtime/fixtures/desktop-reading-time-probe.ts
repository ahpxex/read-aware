import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildReadingTimeTool } from "../../../../../../../packages/agent/src/tools/reading-time";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { accrueReadingSession, flushReadingSessions, listPendingReadingSessions } from "../../../../platform/reading-session";
import { queryReadingTime } from "../../../../domain/reading-time";
import { seedTextStateBooks, cleanupTextStateProbe } from "./desktop-text-state-probe";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import goalsManifest from "../../../../../../../plugins/reading-goals/manifest.json";

const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [];
let books: Record<string, string> = {};
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
async function start(manifest: PluginManifest, moduleUrl: string) {
  const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl });
  workers.set(manifest.id, worker); await worker.checkHealth(); worker.promote();
}
export async function prepareReadingTimeProbe() {
  await isolated(); if (workers.size || Object.keys(books).length) throw Error("Probe already active");
  const seed = await seedTextStateBooks(); books = seed.books;
  try {
    for (const role of ["empty", "read", "write"] as const) {
      const id = `capability-time-${role}`;
      await start({ id, name: id, description: books.normal, schemaVersion: 1, version: "1.0.0",
        permissions: role === "empty" ? [] : [role === "read" ? "reading:read" : "reading:write"],
        requires: { domains: { reading: "^2.7.0" } } }, new URL("./reading-time-probe.ts", import.meta.url).href);
    }
    await start({ ...goalsManifest, id: "capability-time-ui" } as PluginManifest,
      new URL("../../../../../../../plugins/reading-goals/dist/main.js", import.meta.url).href);
    return seed;
  } catch (error) { await cleanupReadingTimeProbe(); throw error; }
}
export async function pluginReadingTime(action = "inspect", role = "read") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(entry => entry.pluginId === `capability-time-${role}` && entry.id === action);
  if (!command) throw Error("Probe command unavailable");
  return JSON.parse((await command.run())!.toast!) as unknown;
}
export async function agentReadingTime(scope: "book" | "global" = "book", query = {}) {
  await isolated();
  const result = await buildReadingTimeTool(scope === "book" ? { kind: "book", bookId: books.normal! }
    : { kind: "global", threadId: "capability-time" }, buildRuntimeDeps()).execute("time-e2e", query);
  if (result.content[0]?.type !== "text") throw Error("Expected Agent text");
  return JSON.parse(result.content[0].text) as unknown;
}
/** Synthetic native persistence probes, not elapsed user reading. Only owned book IDs. */
export async function accrueTimeProbe(deltaMs = 5000, hoursAgo = 0, kind = "normal") {
  await isolated(); const bookId = books[kind]; if (!bookId) throw Error("Unknown owned book");
  await accrueReadingSession(bookId, deltaMs, Date.now() - hoursAgo * 3_600_000);
  return queryReadingTime({ bookId });
}
export async function flushTimeProbe() {
  await isolated();
  return flushReadingSessions((await listPendingReadingSessions()).filter(bucket => Object.values(books).includes(bucket.bookId)));
}
export async function openTimeProbe() {
  await isolated(); return buildRuntimeDeps().reader.openBook(books.normal!);
}
export async function closeTimeProbe() {
  await isolated(); await buildRuntimeDeps().reader.close();
  return queryReadingTime({ bookId: books.normal! });
}
export async function cleanupReadingTimeProbe() {
  await isolated(); await buildRuntimeDeps().reader.close(); await flushTimeProbe();
  const actors = [...workers.keys()];
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const item of owned.splice(0).reverse()) item.dispose();
  const cleanup = await cleanupTextStateProbe(); books = {};
  return { ...cleanup, timeContributions: actors.reduce((sum, actor) => sum + inspectContributions(actor).length, 0) };
}
