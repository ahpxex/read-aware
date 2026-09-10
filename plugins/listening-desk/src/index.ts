import type { PluginModule } from "@read-aware/plugin-types";
import { listeningView } from "./views";
import { tr } from "./strings";

let lifetime: AbortController | undefined;
export default {
  activate(ctx) {
    if (!ctx.domains.reading?.commands) throw new Error("Listening Desk requires reading:write");
    lifetime?.abort();
    const current = new AbortController();
    lifetime = current;
    const title = tr(ctx.locale, "title");
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "speaker", surface: "reader", presentation: "popup", view: () => listeningView(ctx, undefined, current.signal) });
    ctx.contributions.commands.register({ id: "open", title, icon: "speaker", run: async () => ({ view: await listeningView(ctx, undefined, current.signal) }) });
    for (const action of ["start", "stop"] as const) ctx.contributions.commands.register({
      id: action, title: `${title}: ${tr(ctx.locale, action)}`, icon: action === "start" ? "play" : "stop",
      run: async () => {
        current.signal.throwIfAborted();
        const session = await ctx.domains.reading!.queries.session();
        if (!session.sessionId) throw new Error("No active reading session");
        await ctx.domains.reading!.commands!.controlPlayback(action, { sessionId: session.sessionId, bookId: session.bookId ?? undefined }, { signal: current.signal });
      },
    });
  },
  deactivate() { lifetime?.abort(); lifetime = undefined; },
} satisfies PluginModule;
