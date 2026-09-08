import type { PluginModule } from "@read-aware/plugin-types";
import type { SettingChange } from "@read-aware/core";

export default {
  activate(ctx) {
    const settings = ctx.domains.settings;
    const observed: unknown[] = [];
    ctx.services.storage.onChange(() => { observed.push(ctx.services.storage.get("settings")); });
    ctx.contributions.commands.register({
      id: "observed", title: "Inspect settings mirror",
      run: () => ({ toast: JSON.stringify(observed) }),
    });
    ctx.contributions.commands.register({
      id: "update", title: "Settings transaction probe",
      run: async () => {
        const changes = ctx.services.storage.get<SettingChange[]>("changes")!;
        let result: unknown;
        try {
          const updated = await settings.commands.update(changes);
          const allowed = new Set(["appearance.theme", "appearance.motion", "general.startView"]);
          if (updated.settings.settings.some(entry => !allowed.has(entry.path))) throw new Error("Settings response exceeded grant");
          result = { status: "committed", changed: updated.changed, paths: updated.settings.settings.map(entry => entry.path) };
        } catch (error) {
          result = { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null };
        }
        await ctx.services.storage.set("result", result);
      },
    });
  },
} satisfies PluginModule;
