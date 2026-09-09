import type { PluginContext, PluginModule, PluginView, PluginViewChannel, PluginViewContent } from "@read-aware/plugin-types";

export default {
  activate(ctx: PluginContext) {
    let revision = 0, subscriptions = 0, disposed = 0;
    let channel: PluginViewChannel | undefined, finish: (() => void) | undefined;
    const content = (): PluginViewContent => {
      const version = revision;
      return { kind: "blocks", title: `Live ${version}`, blocks: [
        { kind: "form", fields: [{ kind: "text", id: "draft", label: "Draft", value: `Default ${version}` }],
          submitLabel: "Save draft", onSubmit: values => ({ view: { kind: "markdown", title: "Saved draft", markdown: String(values.draft) } }) },
        { kind: "list", items: [{ id: "modal", title: "Open live modal", presentation: "dialog",
          onSelect: () => ({ view: { kind: "markdown", title: "Live modal", markdown: "Independent modal" } }) }] },
        { kind: "actions", actions: [{ id: "action", label: `Action ${version}`, run: () => ({
          view: { kind: "markdown", title: `Action result ${version}`, markdown: `Version ${version}` },
        }) }] },
      ] };
    };
    const open = (slow = false): PluginView => ({ ...content(), live: { subscribe: async next => {
      channel = next; subscriptions++;
      await ctx.services.ui.publishView(next, { revision, view: content() });
      if (slow) await new Promise<void>(resolve => { finish = resolve; });
      return { dispose() { disposed++; } };
    } } });
    const command = (id: string, run: () => unknown | Promise<unknown>) => ctx.contributions.commands.register({ id, title: id,
      run: async () => ({ toast: JSON.stringify(await run()) }) });
    ctx.contributions.commands.register({ id: "open", title: "Live view probe", run: () => ({ view: open() }) });
    ctx.contributions.commands.register({ id: "slow", title: "Slow live view", run: () => ({ view: open(true) }) });
    command("inspect", () => ({ channel, revision, subscriptions, disposed }));
    command("advance", () => ctx.services.ui.publishView(channel!, { revision: ++revision, view: content() }));
    command("stale", () => ctx.services.ui.publishView(channel!, { revision: Math.max(0, revision - 1), view: content() }));
    command("finish", () => { finish?.(); finish = undefined; return true; });
    command("invalid", async () => {
      try { return await ctx.services.ui.publishView(channel!, { revision: ++revision, view: { kind: "invalid", secret: "private malformed payload" } as unknown as PluginViewContent }); }
      catch (error) { return { code: (error as { code?: string }).code }; }
    });
    command("foreign", () => ctx.services.ui.publishView(JSON.parse(ctx.manifest.description!), { revision: 100, view: content() }));
  },
} satisfies PluginModule;
