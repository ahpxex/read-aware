import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect authorized text state", run: async () => ({ toast: JSON.stringify({
      hasLibrary: !!ctx.domains.library,
      hasWrite: !!ctx.domains.library?.commands,
      state: await ctx.domains.library?.queries.books.getTextState(ctx.manifest.description!),
    }) }) });
  },
} satisfies PluginModule;
