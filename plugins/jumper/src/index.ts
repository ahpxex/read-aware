import type { PluginModule } from "@read-aware/plugin-types";
import { assertCapabilities } from "./types";
import { jumperView } from "./views";
import { tr } from "./strings";
import { bookmarksView } from "./bookmark-views";
import { bookmarkCopy } from "./bookmark-strings";
import { registerBookmarkTools } from "./bookmark-tools";

const plugin: PluginModule = {
  activate(ctx) {
    assertCapabilities(ctx);
    registerBookmarkTools(ctx);
    const unavailable = { revision: 0, visible: true, enabled: false };
    const header = ctx.contributions.headerActions.register({ id: "jumper", title: "Jumper", icon: "magnifying-glass", state: unavailable,
      surface: "reader", presentation: "popup", view: () => jumperView(ctx) });
    const open = ctx.contributions.commands.register({ id: "open", title: "Jumper", icon: "magnifying-glass", state: unavailable,
      keywords: "jump chapter text search navigation", run: async () => ({ view: await jumperView(ctx) }) });
    ctx.contributions.commands.register({ id: "bookmarks", title: `Jumper: ${bookmarkCopy(ctx.locale).title}`, icon: "book-bookmark",
      state: { revision: 0, visible: true, enabled: true }, keywords: "bookmark saved location passage",
      run: async () => ({ view: await bookmarksView(ctx) }) });
    const history = (["back", "forward"] as const).map(direction => ({ direction,
      registration: ctx.contributions.commands.register({ id: direction, title: `Jumper: ${tr(ctx.locale, direction)}`, state: unavailable,
        icon: direction === "back" ? "arrow-left" : "arrow-right",
        defaultShortcut: { key: direction === "back" ? "ArrowLeft" : "ArrowRight", alt: true },
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          await ctx.domains.reading.commands[direction]({ sessionId: session.sessionId ?? undefined });
        } }),
    }));
    ctx.domains.reading.events.observeSession(async session => {
      const state = { revision: session.revision + 1, visible: true, enabled: session.status === "ready" };
      await Promise.all([header.updateState(state), open.updateState(state), ...history.map(({ direction, registration }) =>
        registration.updateState({ ...state, enabled: state.enabled && (direction === "back" ? session.history.canGoBack : session.history.canGoForward) }))]);
    });
  },
};
export default plugin;
