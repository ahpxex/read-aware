/** ReadAware's first-party RSS/Atom content provider and agent integration. */
import type { PluginModule } from "@read-aware/plugin-types";
import { registerAgentTools } from "./agent-tools";
import { forgetRemovedBook, loadFeedContent } from "./feed-library";
import { tr } from "./strings";
import { migrateLegacyFeeds } from "./storage";
import { assertPluginCapabilities, PROVIDER_ID } from "./types";
import { refreshAllFeeds, rssPageView } from "./views";

const plugin: PluginModule = {
  async activate(ctx) {
    assertPluginCapabilities(ctx);
    ctx.contributions.contentProviders.register({
      id: PROVIDER_ID,
      load: url => loadFeedContent(ctx, url),
    });
    ctx.contributions.headerActions.register({
      id: "feeds",
      title: "RSS Feeds",
      icon: "globe",
      surface: "shelf",
      presentation: "page",
      view: () => rssPageView(ctx),
    });
    ctx.domains.library.events.subscribe("book.removed", async ({ payload: { bookId } }) => {
      try {
        const feed = await forgetRemovedBook(ctx, bookId);
        if (!feed) return;
        ctx.services.ui.showToast(tr(ctx.locale, "unsubscribedFrom", { title: feed.title }));
      } catch (error) { console.warn("RSS removed-book cleanup failed", error); }
    });
    ctx.contributions.commands.register({
      id: "subscribe",
      title: "RSS: subscriptions",
      icon: "globe",
      keywords: "rss atom feed subscribe",
      run: async () => ({ view: await rssPageView(ctx) }),
    });

    // Declared in manifest.schedules: subscribed feeds stay fresh without a
    // manual refresh — hourly while the app is open, catch-up on launch.
    ctx.services.schedules.bind("refresh-feeds", async () => {
      await refreshAllFeeds(ctx);
    });

    registerAgentTools(ctx);
  },
  async migrate(ctx, migration) {
    if (migration.direction === "upgrade" && migration.fromVersion === 0) {
      await migrateLegacyFeeds({ services: { storage: ctx.storage } });
    }
  },
};

export default plugin;
