import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "drive", title: "Drive", run: async () => {
      const registration = ctx.contributions.commands.register({ id: "child", title: "Child", run() {} });
      const pending = registration.updateState({ revision: 1, enabled: false, visible: true, checked: true });
      const first = await pending;
      const acknowledged = await registration;
      const second = await acknowledged.updateState({ revision: 2, enabled: true, visible: false });
      acknowledged.dispose();
      const retired = await registration.updateState({ revision: 3, enabled: true, visible: true });
      const temporary = ctx.contributions.commands.register({ id: "temporary", title: "Temporary", run() {} });
      const beforeDispose = temporary.updateState({ revision: 1, enabled: true, visible: true });
      temporary.dispose();
      const disposedBeforeAck = await beforeDispose;
      return { toast: JSON.stringify({ first, second, retired, disposedBeforeAck }) };
    } });
  },
};
export default plugin;
