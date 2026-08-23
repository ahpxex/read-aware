/** ReadAware's first-party RSS/Atom content provider and agent integration. */
import type { PluginModule } from "@read-aware/plugin-types";
import { registerAgentTools } from "./agent-tools";
import { fetchFeed } from "./feed";
import { tr } from "./strings";
import { loadFeeds, migrateLegacyFeeds, removeFeed } from "./storage";
import { assertPluginCapabilities, PROVIDER_ID } from "./types";
import { refreshAllFeeds, rssPageView } from "./views";

const plugin: PluginModule = {
  async activate(ctx) {
    assertPluginCapabilities(ctx);
    // Pre-0.7 installs kept subscriptions as one KV array; adopt them into
    // the document collection once.
    await migrateLegacyFeeds(ctx);

    ctx.contributions.contentProviders.register({
      id: PROVIDER_ID,
      load: async (url) => (await fetchFeed(ctx, url)).content,
    });
    ctx.contributions.headerActions.register({
      id: "feeds",
      title: "RSS Feeds",
      icon: "globe",
      surface: "shelf",
      presentation: "page",
      view: () => rssPageView(ctx),
    });
    ctx.domains.library.events.subscribe("book.removed", ({ payload: { bookId } }) => {
      void (async () => {
        const feed = (await loadFeeds(ctx)).find((entry) => entry.bookId === bookId);
        if (!feed) return;
        await removeFeed(ctx, feed.url);
        ctx.services.ui.showToast(tr(ctx.locale, "unsubscribedFrom", { title: feed.title }));
      })();
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
};

export default plugin;
