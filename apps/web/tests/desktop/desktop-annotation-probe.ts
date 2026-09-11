import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { invoke } from "../../src/platform/ipc";
import { localKV } from "../../src/platform/local-store";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { respondToUserInteraction } from "../../src/features/ai/agent/ports/user-interaction-port";
import { buildAnnotationTools } from "../../../../packages/agent/src/tools/annotation-tools";
import { buildThreadTools } from "../../../../packages/agent/src/tools/library-tools";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";

/** Real Agent tools, native SQLite and a WebKit Worker; synthetic traces only. */
export async function runDesktopAnnotationProbe(bookId: string) {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  const deps = buildRuntimeDeps();
  if (!(await deps.library.getBook(bookId))) throw new Error("Probe book missing");
  const scope = { kind: "book" as const, bookId };
  const tools = [...buildAnnotationTools(scope, deps), ...buildThreadTools(scope, deps)];
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  const call = async (name: string, params: Record<string, unknown>) => {
    const result = await tool(name).execute("annotation-probe", params);
    if (result.content[0]?.type !== "text") throw new Error("Expected text result");
    return JSON.parse(result.content[0].text);
  };
  const annotations = createAnnotationsDomain("agent");
  const created: string[] = [];
  const results: Record<string, unknown> = {};
  try {
    const highlight = await call("create_annotation", { kind: "highlight", text: "Annotation capability probe", style: "underline", color: "blue" });
    created.push(highlight.id);
    results.agentCreated = highlight;
    results.agentExact = await call("get_annotations", { annotationId: highlight.id, kind: "highlight" });
    const ask = await annotations.commands.createAsk({ bookId, text: "Synthetic capability probe question" });
    created.push(ask.id);
    for (const readOnly of [true, false]) {
      const id = `capability-annotations-${readOnly ? "read" : "write"}`;
      const prefix = `read-aware-plugin.${id}.`;
      await localKV.setItemAsync(prefix + "input", JSON.stringify({ highlightId: highlight.id, askId: ask.id }));
      const disposables: PluginDisposable[] = [];
      const manifest: PluginManifest = { id, name: "Annotations probe", version: "1.0.0", schemaVersion: 1,
        description: readOnly ? "read-only" : "write", permissions: [readOnly ? "annotations:read" : "annotations:write"],
        requires: { domains: { annotations: "^2.0.0" }, services: { storage: "^2.0.0" } } };
      const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./annotation-probe.ts", import.meta.url).href });
      try {
        await worker.checkHealth(); worker.promote();
        const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id);
        if (!command) throw new Error("Probe command did not register");
        await command.run();
        const disk = await invoke<Record<string, string>>("load_kv_all");
        results[readOnly ? "reader" : "writer"] = JSON.parse(disk[prefix + "result"]);
      } finally {
        try { await worker.terminate(); }
        finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
        await localKV.removeItemAsync(prefix + "input");
        await localKV.removeItemAsync(prefix + "result");
        if (inspectContributions(id).length) throw new Error("Annotation probe left contributions");
      }
    }
    const agentAsk = await annotations.commands.createAsk({ bookId, text: "Synthetic Agent deletion probe" });
    created.push(agentAsk.id);
    const approval = new AbortController();
    const timeout = setTimeout(() => approval.abort(), 5_000);
    try {
      for (const optionId of ["decline", "approve"]) {
        const interactions: unknown[] = [];
        const result = await tool("delete_annotation").execute(`delete-${optionId}`, { annotationId: agentAsk.id }, approval.signal, update => {
          const details = interactionFromToolDetails(update.details);
          if (details?.phase !== "request") return;
          interactions.push(details.request);
          if (!respondToUserInteraction(details.request.id, { optionId })) throw new Error("Approval port was not awaiting the tool");
        });
        const remaining = await annotations.queries.get(agentAsk.id);
        if ((remaining !== null) !== (optionId === "decline")) throw new Error("Agent approval did not gate deletion");
        results[optionId] = { result, interactions, remaining };
      }
    } finally { clearTimeout(timeout); }
    return { dataDir, results, approvalDriver: "actual interaction port answered programmatically, not chat UI or LLM" };
  } finally {
    const failures = await Promise.allSettled(created.map(async id => {
      const snapshot = await annotations.queries.inspect(id);
      if (snapshot) await annotations.commands.applyChanges([{ op: "remove", kind: snapshot.annotation.kind, annotationId: id, expectedRevision: snapshot.revision }]);
    }));
    const errors = failures.filter(result => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), "Probe annotation cleanup failed");
  }
}
