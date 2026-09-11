import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { localKV } from "../../src/platform/local-store";
import { invoke } from "../../src/platform/ipc";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { respondToUserInteraction } from "../../src/features/ai/agent/ports/user-interaction-port";
import { buildAnnotationTools } from "../../../../packages/agent/src/tools/annotation-tools";
import { buildThreadTools } from "../../../../packages/agent/src/tools/library-tools";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";

export async function runDesktopAnnotationMutationProbe(bookId: string) {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  const deps = buildRuntimeDeps();
  if (!(await deps.library.getBook(bookId))) throw new Error("Probe book missing");
  const domain = createAnnotationsDomain("agent");
  const scope = { kind: "book" as const, bookId };
  const tools = [...buildAnnotationTools(scope, deps), ...buildThreadTools(scope, deps)];
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  const call = async (name: string, params: Record<string, unknown>) => {
    const result = await tool(name).execute("mutation-probe", params);
    if (result.content[0]?.type !== "text") throw new Error("Expected text result");
    return JSON.parse(result.content[0].text);
  };
  const created: string[] = [];
  const results: Record<string, unknown> = {};
  try {
    const note = await domain.commands.createNote({ bookId, body: "Mutation probe original" }); created.push(note.id);
    const highlight = await domain.commands.createHighlight({ bookId, text: "Mutation probe quotation" }); created.push(highlight.id);
    const observed = await call("get_annotations", { annotationId: note.id });
    const stale = { annotation: observed.items[0], revision: observed.revision };
    await domain.commands.applyChanges([{ op: "updateNote", annotationId: note.id, body: "Another actor's change", expectedRevision: (await domain.queries.inspect(note.id))!.revision }]);
    for (const readOnly of [true, false]) {
      const id = `capability-annotation-mutations-${readOnly ? "read" : "write"}`;
      const prefix = `read-aware-plugin.${id}.`;
      const disposables: PluginDisposable[] = [];
      let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
      try {
        await localKV.setItemAsync(prefix + "input", JSON.stringify({ stale, highlightId: highlight.id }));
        const manifest: PluginManifest = { id, name: "Annotation mutations probe", version: "1.0.0", schemaVersion: 1, description: readOnly ? "read-only" : "write",
          permissions: [readOnly ? "annotations:read" : "annotations:write"], requires: { domains: { annotations: "^2.0.0" }, services: { storage: "^2.0.0" } } };
        worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./annotation-mutation-probe.ts", import.meta.url).href });
        await worker.checkHealth(); worker.promote();
        const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id);
        if (!command) throw new Error("Mutation probe command missing");
        await command.run();
        const kv = await invoke<Record<string, string>>("load_kv_all");
        results[readOnly ? "reader" : "writer"] = JSON.parse(kv[prefix + "result"]);
      } finally {
        try { await worker?.terminate(); }
        finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
        await localKV.removeItemAsync(prefix + "input"); await localKV.removeItemAsync(prefix + "result");
        if (inspectContributions(id).length) throw new Error("Mutation probe left contributions");
      }
    }
    const fresh = await call("get_annotations", { annotationId: note.id });
    results.agentEdit = await call("edit_annotation", { annotationId: note.id, body: "Agent conditional edit", expectedRevision: fresh.revision });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      let updateDuringApproval: Promise<void> | undefined;
      const deletion = tool("delete_annotation").execute("mutation-approval", { annotationId: note.id }, controller.signal, update => {
        const details = interactionFromToolDetails(update.details);
        if (details?.phase !== "request") return;
        updateDuringApproval = (async () => {
          const snapshot = (await domain.queries.inspect(note.id))!;
          await domain.commands.applyChanges([{ op: "updateNote", annotationId: note.id, body: "Changed while approval was open", expectedRevision: snapshot.revision }]);
          if (!respondToUserInteraction(details.request.id, { optionId: "approve" })) throw new Error("Approval was not pending");
        })();
      });
      try { await deletion; throw new Error("Deletion overwrote a change made during approval"); }
      catch (error) { if ((error as { code?: string }).code !== "annotations/conflict") throw error; }
      await updateDuringApproval;
      results.approvalConflict = { code: "annotations/conflict", remaining: await domain.queries.get(note.id) };
      const n = (await domain.queries.inspect(note.id))!;
      const h = (await domain.queries.inspect(highlight.id))!;
      const changes = [{ op: "updateNote", annotationId: note.id, body: "Agent batch final", expectedRevision: n.revision }, { op: "remove", kind: "highlight", annotationId: highlight.id, expectedRevision: h.revision }];
      for (const optionId of ["decline", "approve"]) {
        const result = await tool("apply_annotation_changes").execute(`batch-${optionId}`, { changes }, controller.signal, update => {
          const details = interactionFromToolDetails(update.details);
          if (details?.phase === "request" && !respondToUserInteraction(details.request.id, { optionId })) throw new Error("Batch approval was not pending");
        });
        const remaining = await domain.queries.get(highlight.id);
        const currentNote = await domain.queries.get(note.id);
        if ((remaining !== null) !== (optionId === "decline") || currentNote?.kind !== "note" || currentNote.body !== (optionId === "decline" ? "Changed while approval was open" : "Agent batch final")) throw new Error("Batch approval did not gate all changes");
        results[optionId] = { result, remaining, note: currentNote };
      }
    } finally { clearTimeout(timeout); }
    return { dataDir, created, results, verification: "Actual Agent tools/interaction port, SQLite and WebKit Worker. Approval responses are programmatic, not LLM/chat UI." };
  } finally {
    const cleanup = await Promise.allSettled(created.map(async id => {
      const snapshot = await domain.queries.inspect(id);
      if (snapshot) await domain.commands.applyChanges([{ op: "remove", kind: snapshot.annotation.kind, annotationId: id, expectedRevision: snapshot.revision }]);
    }));
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Mutation probe cleanup failed");
  }
}
