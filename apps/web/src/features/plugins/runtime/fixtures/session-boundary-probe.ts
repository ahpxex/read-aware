import type { PluginModule } from "@read-aware/plugin-types";
import type { ReadingSessionSnapshot } from "@read-aware/core";

export default {
  activate(ctx) {
    const seen: ReadingSessionSnapshot[] = [];
    ctx.domains.reading?.events.observeSession(state => { seen.push(state); });
    ctx.contributions.commands.register({ id: "read", title: "Read authorized session", run: async () => ({
      toast: JSON.stringify({ services: Object.keys(ctx.services.session), hasReading: Boolean(ctx.domains.reading),
        hasCommands: Boolean(ctx.domains.reading?.commands),
        current: await ctx.domains.reading?.queries.session(), seen }),
    }) });
  },
} satisfies PluginModule;
