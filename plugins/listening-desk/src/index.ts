import type { PluginModule } from "@read-aware/plugin-types";
import { listeningView } from "./views";
import { tr } from "./strings";

export default {
  activate(ctx) {
    if (!ctx.domains.reading?.commands) throw new Error("Listening Desk requires reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "speaker", surface: "reader", presentation: "popup", view: () => listeningView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "speaker", run: async () => ({ view: await listeningView(ctx) }) });
    for (const action of ["start", "stop"] as const) ctx.contributions.commands.register({
      id: action, title: `${title}: ${tr(ctx.locale, action)}`, icon: action === "start" ? "play" : "stop",
      run: async () => {
        const session = await ctx.domains.reading!.queries.session();
        if (!session.sessionId) throw new Error("No active reading session");
        await ctx.domains.reading!.commands!.controlPlayback(action, { sessionId: session.sessionId });
      },
    });
  },
} satisfies PluginModule;
