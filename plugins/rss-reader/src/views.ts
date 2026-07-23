import type { PluginBlock, PluginBlocksView, PluginListItem } from "@read-aware/plugin-types";
import { ensureBook, isHttpFeedUrl, subscribe } from "./feed";
import { feedUrlsFromOpml } from "./opml";
import { loadFeeds, saveFeeds } from "./storage";
import { PROVIDER_ID, type FeedSubscription, type RssPluginContext } from "./types";

function updatedLabel(value: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

export function feedDetailView(
  ctx: RssPluginContext,
  feed: FeedSubscription,
): PluginBlocksView {
  const articleItems: PluginListItem[] = feed.articles.map((article) => ({
    id: article.id,
    title: article.title,
    subtitle: article.publishedAt,
    icon: "article",
    onSelect: async () => {
      const healed = await ensureBook(ctx, feed);
      ctx.reader.goTo({ bookId: healed.bookId, href: article.id });
      return { close: true };
    },
  }));

  return {
    kind: "blocks",
    title: feed.title,
    blocks: [
      {
        kind: "keyValue",
        rows: [
          { label: "Feed", value: feed.url },
          { label: "Articles", value: String(feed.articles.length) },
          { label: "Updated", value: updatedLabel(feed.lastFetched) },
        ],
      },
      {
        kind: "actions",
        actions: [
          {
            id: "open",
            label: "Open as book",
            icon: "book-open",
            variant: "solid",
            run: async () => {
              const healed = await ensureBook(ctx, feed);
              ctx.reader.openBook(healed.bookId);
              return { close: true };
            },
          },
          {
            id: "refresh",
            label: "Refresh",
            run: async () => {
              const fresh = await subscribe(ctx, feed.url);
              return { toast: "Feed refreshed", view: feedDetailView(ctx, fresh) };
            },
          },
          {
            id: "remove",
            label: "Unsubscribe",
            variant: "danger",
            run: async () => {
              await ctx.books.write.removeVirtualBook({
                providerId: PROVIDER_ID,
                key: feed.url,
              });
              saveFeeds(
                ctx,
                loadFeeds(ctx).filter((entry) => entry.url !== feed.url),
              );
              return { toast: `Unsubscribed “${feed.title}”`, view: rssPageView(ctx) };
            },
          },
        ],
      },
      { kind: "divider" },
      { kind: "heading", text: "Articles", caption: "Open one to jump straight to it" },
      {
        kind: "list",
        emptyText: "Refresh to load articles.",
        items: articleItems,
      },
    ],
  };
}

export function rssPageView(ctx: RssPluginContext): PluginBlocksView {
  const feeds = loadFeeds(ctx);
  const total = feeds.reduce((sum, feed) => sum + feed.articles.length, 0);
  const feedItems: PluginListItem[] = feeds.map((feed) => ({
    id: feed.url,
    title: feed.title,
    subtitle: `${feed.articles.length} articles · ${feed.url}`,
    icon: "globe",
    onSelect: () => ({ view: feedDetailView(ctx, feed) }),
  }));

  const blocks: PluginBlock[] = [
    {
      kind: "heading",
      text: "Subscriptions",
      caption: `${feeds.length} feed${feeds.length === 1 ? "" : "s"} · ${total} articles cached`,
    },
    {
      kind: "form",
      fields: [
        {
          kind: "text",
          id: "url",
          label: "Feed URL",
          placeholder: "https://example.com/feed.xml",
          inputMode: "url",
        },
      ],
      submitLabel: "Subscribe",
      onSubmit: async (values) => {
        const url = String(values.url ?? "").trim();
        if (!isHttpFeedUrl(url)) {
          return { fieldErrors: { url: "Enter a valid http(s) feed URL" } };
        }
        if (loadFeeds(ctx).some((feed) => feed.url === url)) {
          return { fieldErrors: { url: "Already subscribed" } };
        }
        const feed = await subscribe(ctx, url);
        return { toast: `Subscribed to “${feed.title}”`, view: rssPageView(ctx) };
      },
    },
    { kind: "divider" },
    {
      kind: "list",
      emptyText: "No subscriptions yet — add a feed above.",
      items: feedItems,
    },
  ];

  if (feeds.length > 0) {
    blocks.push({
      kind: "actions",
      actions: [
        {
          id: "refresh-all",
          label: "Refresh all",
          icon: "arrow-square-out",
          run: async () => {
            for (const feed of loadFeeds(ctx)) {
              try {
                await subscribe(ctx, feed.url);
              } catch {
                // One unavailable feed must not prevent the others from refreshing.
              }
            }
            return { toast: "All feeds refreshed", view: rssPageView(ctx) };
          },
        },
      ],
    });
  }

  blocks.push(
    { kind: "divider" },
    { kind: "heading", text: "Import", caption: "Paste an OPML export to bulk-subscribe" },
    {
      kind: "form",
      fields: [{ kind: "textarea", id: "opml", label: "OPML", rows: 4 }],
      submitLabel: "Import",
      onSubmit: async (values) => {
        const text = String(values.opml ?? "").trim();
        if (!text) return { fieldErrors: { opml: "Paste OPML XML first" } };

        const urls = feedUrlsFromOpml(text);
        if (urls.length === 0) {
          return { fieldErrors: { opml: "No feed URLs found in this OPML" } };
        }

        let added = 0;
        for (const url of urls) {
          if (loadFeeds(ctx).some((feed) => feed.url === url)) continue;
          try {
            await subscribe(ctx, url);
            added += 1;
          } catch {
            // Report the aggregate result; inaccessible feeds remain unmodified.
          }
        }
        return { toast: `Imported ${added} of ${urls.length} feeds`, view: rssPageView(ctx) };
      },
    },
  );

  return { kind: "blocks", blocks };
}
