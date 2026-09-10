import type { PluginModule } from "@read-aware/plugin-types";
import { memoryDesk } from "./views";
import { strings } from "./strings";
import { conversationControls } from "./conversation-controls";

export default {
  activate(ctx) {
    if (!ctx.domains.memory || !ctx.domains.library || !ctx.domains.conversations || !ctx.domains.reading?.commands) throw Error("Memory Desk requires memory:read, library:read, conversations:read and reading:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "brain", run: async () => ({ view: await memoryDesk(ctx) }) });
    for (const surface of ["shelf", "reader"] as const) ctx.contributions.headerActions.register({ id: surface, title, icon: "brain", surface, presentation: "popup", view: () => memoryDesk(ctx) });
    ctx.contributions.headerActions.register({ id: "agent", title, icon: "brain", surface: "agent", view: input => {
      if (!input.thread) throw Object.assign(Error("Agent header target missing"), { code: "ui/unavailable" });
      return conversationControls(ctx, input.thread, title);
    } });
  },
} satisfies PluginModule;
