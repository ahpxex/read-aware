import type { PluginContext, PluginMigrationContext } from "@read-aware/plugin-types";

export function activate(ctx: PluginContext) {
  ctx.contributions.commands.register({ id: "documents", title: "Documents", async run() {
    const page = await ctx.services.storage.collection("words").page({ limit: 1 });
    if (page.status !== "ready") return { toast: "stale" };
    const result = await ctx.services.storage.applyDocuments([{ kind: "check", collection: "words", id: page.items[0].id, expectedRevision: page.items[0].revision }]);
    return { toast: result.status };
  } });
}

export async function migrate(ctx: PluginMigrationContext) {
  await ctx.storage.applyDocuments([{ kind: "put", collection: "words", id: "seed", data: {}, expectedRevision: null }]);
}

export default { activate, migrate };
