import type { PluginDetailView, PluginModule } from "@read-aware/plugin-types";

const detail = (title: string): PluginDetailView => ({
  kind: "detail", title, content: [{ kind: "markdown", markdown: title }],
  actions: [{ id: "ping", label: "Ping", run: () => ({ toast: "alive" }) }],
});
const root = (): PluginDetailView => ({
  kind: "detail", title: "Root view",
  content: [{ kind: "list", items: [{ id: "modal", title: "Open modal", presentation: "dialog", onSelect: () => ({ view: detail("Modal view") }) }] }],
  actions: [
    { id: "ping", label: "Ping", run: () => ({ toast: "alive" }) },
    { id: "push", label: "Push", run: () => ({ view: detail("Child view") }) },
    { id: "replace", label: "Replace", run: () => ({ view: detail("Replacement view"), navigation: "replace" }) },
    { id: "reset", label: "Reset", run: () => ({ view: detail("Reset view"), navigation: "reset" }) },
    { id: "slow", label: "Slow", run: async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
      return { view: detail("Late view"), toast: "unexpected late toast" };
    } },
  ],
});

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "open", title: "View lifetime probe", run: () => ({ view: root() }) });
    ctx.contributions.commands.register({ id: "slow", title: "Pending view lifetime probe", run: async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
      return { view: root() };
    } });
  },
} satisfies PluginModule;
