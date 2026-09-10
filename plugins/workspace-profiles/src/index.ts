import type { PluginModule } from "@read-aware/plugin-types";
import { registerProfileTools } from "./tools";
import { copy } from "./strings";
import { profilesView } from "./views";

export default {
  activate(ctx) {
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "profiles", title, icon: "cards", surface: "shelf", presentation: "popup", view: () => profilesView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "cards", run: async () => ({ view: await profilesView(ctx) }) });
    registerProfileTools(ctx);
  },
} satisfies PluginModule;
