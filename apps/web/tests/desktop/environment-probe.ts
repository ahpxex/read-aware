import type { PluginDisposable, PluginModule } from "@read-aware/plugin-types";
import type { HostEnvironmentSnapshot } from "@read-aware/core";

export default {
  activate(ctx) {
    const seen: HostEnvironmentSnapshot[] = [];
    let observation: PluginDisposable | undefined = ctx.services.session.observeEnvironment(state => { seen.push(state); });
    for (const id of ["read", "dispose"] as const) ctx.contributions.commands.register({
      id, title: id, run: async () => {
        if (id === "dispose") { (await observation)?.dispose(); observation = undefined; }
        return { toast: JSON.stringify({ current: await ctx.services.session.environment(), seen,
          hasReading: Boolean(ctx.domains.reading), version: ctx.capabilities.services.session }) };
      },
    });
  },
} satisfies PluginModule;
