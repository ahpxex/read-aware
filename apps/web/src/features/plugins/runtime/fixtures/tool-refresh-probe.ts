import type { PluginActionRegistration, PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    let revision = 0, calls = 0, generation = 0;
    let target: PluginActionRegistration;
    const register = (enabled: boolean) => {
      const version = ++generation;
      return ctx.contributions.agentTools!.register({
        name: "target", description: `Target generation ${version}`,
        state: { revision: 0, visible: true, enabled },
        execute: () => ({ calls: ++calls, generation: version }),
      });
    };
    target = register(false);
    const enable = () => target.updateState({ revision: ++revision, visible: true, enabled: true });
    ctx.contributions.agentTools!.register({ name: "arm", description: "Enable the target tool", execute: enable });
    ctx.contributions.commands.register({ id: "disable", title: "Disable target", run: async () => {
      await target.updateState({ revision: ++revision, visible: true, enabled: false });
    } });
    ctx.contributions.commands.register({ id: "replace", title: "Replace target", run: () => {
      target.dispose(); target = register(true); revision = 0;
    } });
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect target", run: () => ({ toast: JSON.stringify({ calls, generation }) }) });
  },
} satisfies PluginModule;
