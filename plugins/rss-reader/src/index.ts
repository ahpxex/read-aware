/** ReadAware's first-party RSS/Atom content provider and agent integration. */
import type { PluginModule } from "@read-aware/plugin-types";
import { registerAgentTools } from "./agent-tools";
import { fetchFeed } from "./feed";
import { loadFeeds, saveFeeds } from "./storage";
import { assertPluginCapabilities, PROVIDER_ID } from "./types";
import { rssPageView } from "./views";

const plugin: PluginModule = {
  activate(ctx) {
    assertPluginCapabilities(ctx);

    ctx.books.write.registerContentProvider({
      id: PROVIDER_ID,
      load: async (url) => (await fetchFeed(ctx, url)).content,
    });
    ctx.ui.registerHeaderAction({
      id: "feeds",
      title: "RSS Feeds",
      icon: "globe",
      surface: "shelf",
      presentation: "page",
      view: () => rssPageView(ctx),
    });
    ctx.books.on("book.removed", ({ payload: { bookId } }) => {
      const feeds = loadFeeds(ctx);
      const feed = feeds.find((entry) => entry.bookId === bookId);
      if (!feed) return;

      saveFeeds(
        ctx,
        feeds.filter((entry) => entry.url !== feed.url),
      );
      ctx.ui.showToast(`Unsubscribed “${feed.title}”`);
    });
    ctx.ui.registerCommand({
      id: "subscribe",
      title: "RSS: subscriptions",
      icon: "globe",
      keywords: "rss atom feed subscribe",
      run: () => ({ view: rssPageView(ctx) }),
    });

    registerAgentTools(ctx);
  },
};

export default plugin;
