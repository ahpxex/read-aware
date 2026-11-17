import type { PluginListItem, PluginModule } from "@read-aware/plugin-types";

let runs = 0;
const plugin: PluginModule = {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "wire-budget",
      title: "Wire budget",
      run: () => {
        runs++;
        if (runs === 1) {
          const items: PluginListItem[] = [];
          items.length = 1_000_001;
          return {
            view: {
              kind: "list",
              items,
              actions: [{ id: "unused", label: "Unsent callback", run: () => ({ toast: "unused" }) }],
            },
          };
        }
        if (runs === 3) throw new Error("x".repeat(5000));
        return { toast: "recovered" };
      },
    });
  },
};
export default plugin;
