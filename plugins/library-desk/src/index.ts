import type { PluginModule } from "@read-aware/plugin-types";
import { libraryDesk } from "./views";
import { strings } from "./strings";

export default {
  activate(ctx) {
    if (!ctx.domains.library?.commands) throw Error("Library Desk requires library:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "books", run: async () => ({ view: await libraryDesk(ctx) }) });
    ctx.contributions.headerActions.register({ id: "shelf", title, icon: "books", surface: "shelf", presentation: "popup", view: () => libraryDesk(ctx) });
  },
} satisfies PluginModule;
