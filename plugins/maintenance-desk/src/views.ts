import type { PluginBlock, PluginContext, PluginDetailView, PluginView, PluginViewChannel, PluginViewResult } from "@read-aware/plugin-types";
import { catalogViews } from "./catalog";
import { Operations, failureCode, type Entry, type Operation, type Outcome } from "./operations";
import { copy } from "./strings";
import { adminCopy } from "./admin-strings";
import { pluginDirectory } from "./plugin-directory";
import { updateViews } from "./updates";
import { syncViews } from "./sync";

export function maintenanceDesk(ctx: PluginContext) {
  const t = copy(ctx.locale), operations = new Operations(), lifetime = new AbortController();
  const catalog = catalogViews(ctx, lifetime.signal);
  const admin = adminCopy(ctx.locale), directory = pluginDirectory(ctx, lifetime.signal), updates = updateViews(ctx, lifetime.signal);
  const actions = ["connection", "backupExport", "backupImport", "reportExport", "reportSend", "verify"] as const satisfies readonly Operation[];
  type ReviewOperation = typeof actions[number];
  const run = async (operation: ReviewOperation, signal: AbortSignal): Promise<Outcome> => {
    const options = { signal };
    if (operation === "connection") {
      const result = await ctx.services.maintenance.requestConnectionTest(options);
      return { status: result.status === "empty" ? "emptyResponse" : result.status };
    }
    if (operation === "backupExport" || operation === "backupImport") {
      const result = await ctx.services.maintenance.requestBackup(operation === "backupExport" ? "export" : "import", options);
      return { status: result.status };
    }
    if (operation === "reportExport" || operation === "reportSend") {
      const result = await ctx.services.diagnostics!.requestReport(operation === "reportExport" ? "export" : "send", options);
      return { status: result.status };
    }
    const result = await ctx.services.diagnostics!.verifyProjections(options);
    return { status: result.consistent ? "consistent" : "drifted", counts: {
      events: result.eventsReplayed, tables: result.driftedTables, liveRows: result.onlyLiveRows, replayRows: result.onlyReplayedRows,
    } };
  };
  const status = (entry: Entry) => entry.outcome ? t[entry.outcome.status] : t[entry.phase];
  const review = (operation: ReviewOperation): PluginView => ({
    kind: "detail", title: t[operation], content: [
      { kind: "text", text: operation === "connection" ? t.connectionReview : operation === "verify" ? t.verifyReview
        : operation.startsWith("backup") ? t.backupReview : t.reportReview },
      ...(operation === "backupImport" ? [{ kind: "text" as const, text: t.importReview }] : []),
    ], actions: [{ id: "continue", label: t.continue, icon: "arrow-right", variant: operation === "backupImport" ? "danger" : "solid",
      run: (): PluginViewResult => {
        if (!operations.start(operation, signal => run(operation, signal))) return { toast: t.busy };
        // Leave native controls accessible; the wait belongs to this activation.
        return operation === "verify" ? { view: history(), navigation: "reset" } : { close: true };
      },
    }],
  });
  const entryBlocks = (entry: Entry): PluginBlock[] => [
    { kind: "heading", text: t[entry.operation], caption: entry.timestamp },
    ...(entry.errorCode ? [{ kind: "error" as const, code: entry.errorCode }] : []),
    ...(entry.phase === "pending" || entry.phase === "cancelling" ? [{ kind: "progress" as const, value: null, label: status(entry),
      ...(entry.phase === "pending" ? { cancel: { id: `cancel-${entry.id}`, label: t.cancel, run: () => { operations.cancel(entry.id); } } } : {}),
    }] : [{ kind: "text" as const, text: status(entry) }]),
    ...(entry.outcome?.counts ? [{ kind: "keyValue" as const, rows: Object.entries(entry.outcome.counts).map(([key, value]) => ({
      label: t[key as keyof NonNullable<Outcome["counts"]>], value: String(value),
    })) }] : []),
  ];
  const history = (): PluginView => {
    let channel: PluginViewChannel | undefined, revision = 0;
    const content = (): PluginDetailView => {
      const entries = operations.snapshot();
      return { kind: "detail", title: t.results,
        content: entries.length ? entries.flatMap(entryBlocks) : [{ kind: "text", text: t.noResults }],
        actions: [
          { id: "clear", label: t.clear, icon: "trash", run: () => { operations.clear(); return { view: history(), navigation: "replace" }; } },
          { id: "home", label: t.back, icon: "arrow-left", run: () => ({ view: home(), navigation: "reset" }) },
        ],
      };
    };
    const publish = () => {
      if (!channel || lifetime.signal.aborted) return;
      void ctx.services.ui.publishView(channel, { revision: ++revision, view: content() }).catch(async error => {
        try { await ctx.services.logging.write({ level: "warn", event: "maintenance-view-publish-failed", errorCode: failureCode(error) }); }
        catch { /* Retired hosts may reject logging too; the journal remains readable on reopen. */ }
      });
    };
    return { ...content(), live: { subscribe: next => {
      channel = next;
      const subscription = operations.subscribe(publish);
      publish();
      return { dispose() { subscription.dispose(); if (channel?.id === next.id) channel = undefined; } };
    } } };
  };
  const sync = syncViews(ctx, lifetime.signal, operations, history);
  const home = (): PluginView => ({
    kind: "list", title: t.title,
    items: [
      { id: "catalog", title: t.catalog, icon: "list-bullets", onSelect: () => ({ view: catalog.form() }) },
      { id: "plugins", title: admin.plugins, icon: "list-bullets", onSelect: async () => ({ view: await directory.page() }) },
      { id: "updates", title: admin.updates, icon: "arrows-clockwise", onSelect: async () => ({ view: await updates.open() }) },
      { id: "sync", title: sync.title, icon: "arrows-clockwise", onSelect: async () => ({ view: await sync.open() }) },
      ...actions.map(operation => ({ id: operation, title: t[operation], icon: operation === "verify" ? "database" : "arrow-square-out",
        onSelect: () => ({ view: review(operation) }),
      })),
      { id: "results", title: t.results, icon: "clock", onSelect: () => ({ view: history() }) },
    ],
  });
  return { home, dispose() { lifetime.abort(); operations.dispose(); } };
}
