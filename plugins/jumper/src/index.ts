import type { PluginModule } from "@read-aware/plugin-types";
import { assertCapabilities } from "./types";
import { jumperView } from "./views";
import { bookmarksView } from "./bookmark-views";
import { bookmarkCopy } from "./bookmark-strings";
import { registerBookmarkTools } from "./bookmark-tools";
import { listBookmarkPage } from "./bookmark-service";

const plugin: PluginModule = {
  services: { "bookmark-page": listBookmarkPage },
  activate(ctx) {
    assertCapabilities(ctx);
    registerBookmarkTools(ctx);
    const unavailable = { revision: 0, visible: true, enabled: false };
    const always = { revision: 0, visible: true, enabled: true };
    const header = ctx.contributions.headerActions.register({
      id: "jumper",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      surface: "reader",
      presentation: "popup",
      view: () => jumperView(ctx),
    });
    const open = ctx.contributions.commands.register({
      id: "open",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      keywords: "jump chapter page text search navigation",
      run: async () => ({ view: await jumperView(ctx) }),
    });
    ctx.contributions.commands.register({
      id: "bookmarks",
      title: `Jumper: ${bookmarkCopy(ctx.locale).title}`,
      icon: "book-bookmark",
      state: always,
      keywords: "bookmark saved location passage",
      run: async () => ({ view: await bookmarksView(ctx) }),
    });
    ctx.contributions.headerActions.register({
      id: "bookmarks",
      title: bookmarkCopy(ctx.locale).title,
      icon: "book-bookmark",
      state: always,
      surface: "reader",
      presentation: "popup",
      view: (input) => bookmarksView(ctx, input.book?.id),
    });
    ctx.domains.reading.events.observeSession(
      async (session, delivery) => {
        if (delivery?.reaction?.status === "cycle") return;
        const state = { revision: session.revision + 1, visible: true, enabled: session.status === "ready" };
        // Back / forward commands and their Alt+Arrow shortcuts moved into the
        // reader itself; the jump view keeps its own back/forward actions.
        await Promise.all([
          ctx.withEvent(delivery, header).updateState(state),
          ctx.withEvent(delivery, open).updateState(state),
        ]);
      },
      { ruleId: "reader-action-state" },
    );
  },
};
export default plugin;
