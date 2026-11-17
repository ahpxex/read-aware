import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "retry",
      title: "Retry",
      run: async () => {
        const options: { retry: "safe" | "none" } = { retry: "safe" };
        const pending = ctx.services.network!.fetch(
          ctx.manifest.description?.startsWith("http") ? ctx.manifest.description : "https://a.test/retry",
          undefined,
          options,
        );
        options.retry = "none";
        const response = await pending;
        return { toast: await response.text() };
      },
    });
  },
};
export default plugin;
