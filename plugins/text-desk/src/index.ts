import type { PluginModule } from "@read-aware/plugin-types";
import { textDesk } from "./views";
import { tr } from "./strings";

export default {
  activate(ctx) {
    if (!ctx.domains.library?.commands || !ctx.domains.reading?.commands) throw Error("Text Desk requires library:write and reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.commands.register({ id: "open", title, icon: "book-open", run: async () => ({ view: await textDesk(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "book-open", surface: "reader", presentation: "popup", view: () => textDesk(ctx) });
  },
} satisfies PluginModule;
