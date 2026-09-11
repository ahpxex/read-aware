import type { PluginContext, PluginMigrationContext } from "@read-aware/plugin-types";

export function activate(ctx: PluginContext) {
  ctx.contributions.commands.register({ id: "documents", title: "Documents", async run() {
    if (ctx.manifest.description === "observe-documents") {
      return await new Promise<{ toast: string }>(resolve => {
        const subscription = ctx.services.storage.observeDocuments({ kind: "get", collection: "words", id: "word" }, event => {
          subscription.dispose(); resolve({ toast: `${event.status}:${event.sequence}` });
        });
      });
    }
    const page = await ctx.services.storage.collection("words").page({ limit: 1, query: "École 中文" });
    if (page.status !== "ready") return { toast: "stale" };
    const result = await ctx.services.storage.applyDocuments([{ kind: "check", collection: "words", id: page.items[0].id, expectedRevision: page.items[0].revision }]);
    return { toast: result.status };
  } });
}

export async function migrate(ctx: PluginMigrationContext) {
  if ("observeDocuments" in ctx.storage) throw Error("Migration must not observe documents");
  await ctx.storage.applyDocuments([{ kind: "put", collection: "words", id: "seed", data: {}, expectedRevision: null }]);
}

export default { activate, migrate };
