import type { PluginModule } from "@read-aware/plugin-types";
export default { activate(ctx) {
  const range = JSON.parse(ctx.manifest.description!);
  ctx.contributions.commands.register({ id: "read", title: "Held range read", run: async () => ({
    toast: JSON.stringify(await ctx.domains.library!.queries.books.readRange({ range })),
  }) });
} } satisfies PluginModule;
