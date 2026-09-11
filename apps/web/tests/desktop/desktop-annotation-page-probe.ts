import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { AnnotationPage, PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { localKV } from "../../src/platform/local-store";
import { invoke } from "../../src/platform/ipc";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildThreadTools } from "../../../../packages/agent/src/tools/library-tools";

/** Native IPC + the real Agent port and Worker bridge; never touches user data. */
export async function runDesktopAnnotationPageProbe(bookId: string) {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  const deps = buildRuntimeDeps();
  if (!(await deps.library.getBook(bookId))) throw new Error("Probe book missing");
  const domain = createAnnotationsDomain("agent");
  const get = buildThreadTools({ kind: "book", bookId }, deps).find(tool => tool.name === "get_annotations")!;
  const call = async (params: Record<string, unknown>): Promise<AnnotationPage> => {
    const result = await get.execute("annotation-page-probe", params);
    if (result.content[0]?.type !== "text") throw new Error("Expected text result");
    return JSON.parse(result.content[0].text);
  };
  const query = `pageprobe${crypto.randomUUID().replaceAll("-", "")}`;
  const created: string[] = [];
  const results: Record<string, unknown> = {};
  try {
    const notes = [];
    for (let n = 0; n < 5; n++) {
      const note = await domain.commands.createNote({ bookId, body: `${query} note ${n}` });
      notes.push(note); created.push(note.id);
    }
    const highlight = await domain.commands.createHighlight({ bookId, text: query });
    created.push(highlight.id);
    const expectedIds = notes.sort((a, b) => a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)).map(note => note.id);
    const filter = { query, kind: "note" };
    const first = await call({ ...filter, limit: 2 });
    if (JSON.stringify(first.items.map(item => item.id)) !== JSON.stringify(expectedIds.slice(0, 2)) || !first.nextCursor) throw new Error("Agent first page differs from native ordering");
    results.agentFirst = first;
    for (const authorized of [false, true]) {
      const id = `capability-annotation-pages-${authorized ? "read" : "denied"}`;
      const prefix = `read-aware-plugin.${id}.`;
      await localKV.setItemAsync(prefix + "input", JSON.stringify({ bookId, query, cursor: first.nextCursor, expectedIds }));
      const disposables: PluginDisposable[] = [];
      const manifest: PluginManifest = { id, name: "Annotation pages probe", version: "1.0.0", schemaVersion: 1,
        permissions: authorized ? ["annotations:read"] : [], requires: { domains: { annotations: "^2.0.0" }, services: { storage: "^2.0.0" } } };
      const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./annotation-page-probe.ts", import.meta.url).href });
      try {
        await worker.checkHealth(); worker.promote();
        const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id);
        if (!command) throw new Error("Page probe command missing");
        await command.run();
        const disk = await invoke<Record<string, string>>("load_kv_all");
        const result = JSON.parse(disk[prefix + "result"]);
        if (result.authorized !== authorized) throw new Error("Wrong annotation permission boundary");
        results[authorized ? "worker" : "denied"] = result;
      } finally {
        try { await worker.terminate(); }
        finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
        await localKV.removeItemAsync(prefix + "input");
        await localKV.removeItemAsync(prefix + "result");
        if (inspectContributions(id).length) throw new Error("Page probe left contributions");
      }
    }
    const removed = (await domain.queries.inspect(first.items[1].id))!;
    await domain.commands.applyChanges([{ op: "remove", kind: removed.annotation.kind, annotationId: removed.annotation.id, expectedRevision: removed.revision }]);
    const newer = await domain.commands.createNote({ bookId, body: `${query} inserted after first page` });
    created.push(newer.id);
    const continued = await call({ ...filter, cursor: first.nextCursor, limit: 100 });
    if (JSON.stringify(continued.items.map(item => item.id)) !== JSON.stringify(expectedIds.slice(2)) || continued.nextCursor !== null) throw new Error("Live bookmark shifted after concurrent writes");
    results.afterConcurrentWrites = continued;
    return { dataDir, query, results, verification: "actual Agent tool, SQLite and WebKit Worker; not LLM or UI interaction" };
  } finally {
    const cleanup = await Promise.allSettled(created.map(async id => {
      const snapshot = await domain.queries.inspect(id);
      if (snapshot) await domain.commands.applyChanges([{ op: "remove", kind: snapshot.annotation.kind, annotationId: id, expectedRevision: snapshot.revision }]);
    }));
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Page probe cleanup failed");
  }
}
