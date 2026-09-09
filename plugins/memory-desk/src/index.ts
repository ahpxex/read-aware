import type { PluginModule } from "@read-aware/plugin-types";
import { memoryDesk } from "./views";
import { strings } from "./strings";

export default {
  activate(ctx) {
    if (!ctx.domains.memory || !ctx.domains.library || !ctx.domains.reading?.commands) throw Error("Memory Desk requires memory:read, library:read and reading:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "brain", run: async () => ({ view: await memoryDesk(ctx) }) });
    for (const surface of ["shelf", "reader"] as const) ctx.contributions.headerActions.register({ id: surface, title, icon: "brain", surface, presentation: "popup", view: () => memoryDesk(ctx) });
  },
} satisfies PluginModule;
