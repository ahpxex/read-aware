import type { PluginModule, SettingsObservation } from "@read-aware/plugin-types";
export default { activate(ctx) {
  const seen: SettingsObservation[] = [];
  const observation = ctx.domains.settings.queries.observe({}, state => { seen.push(state); if (seen.length > 20) seen.shift(); });
  ctx.contributions.commands.register({ id: "inspect", title: "Inspect settings", run: () => ({ toast: JSON.stringify(seen) }) });
  ctx.contributions.commands.register({ id: "stop", title: "Stop settings observation", run: () => { observation.dispose(); return { toast: String(seen.length) }; } });
  ctx.contributions.commands.register({ id: "write", title: "Write theme", run: async () => {
    const result = await ctx.domains.settings.commands.update([{ path: "appearance.theme", value: "dark" }]);
    return { toast: JSON.stringify(result) };
  } });
} } satisfies PluginModule;
