/**
 * Host-rendered surfaces. The root is the subscriptions themselves — a
 * searchable list with its management commands at the list edge; adding and
 * importing are pushed forms, not permanent page furniture. Each feed opens
 * as a detail view: provenance in metadata, commands as detail actions, and
 * the articles as the content.
 */
import type {
  PluginDetailView,
  PluginFormView,
  PluginListItem,
  PluginListView,
} from "@read-aware/plugin-types";
import { ensureBook, isHttpFeedUrl, subscribe } from "./feed";
import { feedUrlsFromOpml } from "./opml";
import { loadFeeds, saveFeeds } from "./storage";
import { PROVIDER_ID, type FeedSubscription, type RssPluginContext } from "./types";

function formatWhen(
  ctx: RssPluginContext,
  iso: string | undefined,
  style: "date" | "dateTime",
): string | undefined {
  if (!iso) return undefined;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat(ctx.locale, {
      dateStyle: "medium",
      ...(style === "dateTime" ? { timeStyle: "short" } : {}),
    }).format(value);
  } catch {
    return iso.slice(0, 10);
  }
}

/** Refresh every subscription, tolerating individual failures. */
async function refreshAllFeeds(ctx: RssPluginContext): Promise<string> {
  let refreshed = 0;
  let failed = 0;
  for (const feed of loadFeeds(ctx)) {
    try {
      await subscribe(ctx, feed.url);
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }
  return failed === 0
    ? `Refreshed ${refreshed} feed${refreshed === 1 ? "" : "s"}`
    : `Refreshed ${refreshed} of ${refreshed + failed} feeds`;
}

export function addFeedView(ctx: RssPluginContext): PluginFormView {
  return {
    kind: "form",
    title: "Add feed",
    fields: [
      {
        kind: "text",
        id: "url",
        label: "Feed URL",
        placeholder: "https://example.com/feed.xml",
        inputMode: "url",
        helperText:
          "RSS and Atom feeds are read as books on your shelf — articles become chapters.",
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
      return {
        toast: `Subscribed to “${feed.title}”`,
        view: rssPageView(ctx),
        navigation: "reset",
      };
    },
  };
}

export function importOpmlView(ctx: RssPluginContext): PluginFormView {
  return {
    kind: "form",
    title: "Import OPML",
    fields: [
      {
        kind: "textarea",
        id: "opml",
        label: "OPML",
        rows: 8,
        placeholder: "<opml version=\"2.0\">…",
        helperText: "Paste the OPML export from your previous feed reader.",
      },
    ],
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
      return {
        toast: `Imported ${added} of ${urls.length} feeds`,
        view: rssPageView(ctx),
        navigation: "reset",
      };
    },
  };
}

export function feedDetailView(
  ctx: RssPluginContext,
  feed: FeedSubscription,
): PluginDetailView {
  const articleItems: PluginListItem[] = feed.articles.map((article) => ({
    id: article.id,
    title: article.title,
    subtitle: formatWhen(ctx, article.publishedAtIso, "date"),
    icon: "article",
    onSelect: async () => {
      const healed = await ensureBook(ctx, feed);
      ctx.reader.goTo({ bookId: healed.bookId, href: article.id });
      return { close: true };
    },
  }));

  return {
    kind: "detail",
    title: feed.title,
    metadata: [
      { kind: "label", label: "Feed", value: feed.url, icon: "globe" },
      {
        kind: "label",
        label: "Updated",
        value: formatWhen(ctx, feed.lastFetched, "dateTime") ?? "—",
        icon: "calendar",
      },
      { kind: "label", label: "Articles", value: String(feed.articles.length) },
    ],
    actions: [
      {
        id: "open",
        label: "Open as book",
        icon: "book-open",
        run: async () => {
          const healed = await ensureBook(ctx, feed);
          ctx.reader.openBook(healed.bookId);
          return { close: true };
        },
      },
      {
        id: "refresh",
        label: "Refresh",
        icon: "arrows-clockwise",
        run: async () => {
          const fresh = await subscribe(ctx, feed.url);
          return {
            toast: "Feed refreshed",
            view: feedDetailView(ctx, fresh),
            navigation: "replace",
          };
        },
      },
      {
        id: "remove",
        label: "Unsubscribe",
        icon: "trash",
        variant: "danger",
        run: async () => {
          await ctx.shelf.books.write.removeVirtualBook({
            providerId: PROVIDER_ID,
            key: feed.url,
          });
          saveFeeds(
            ctx,
            loadFeeds(ctx).filter((entry) => entry.url !== feed.url),
          );
          return {
            toast: `Unsubscribed “${feed.title}”`,
            view: rssPageView(ctx),
            navigation: "reset",
          };
        },
      },
    ],
    content: [
      {
        kind: "list",
        searchable: feed.articles.length > 8,
        searchPlaceholder: "Search articles",
        emptyText: "No articles yet — refresh to load them.",
        items: articleItems,
      },
    ],
  };
}

export function rssPageView(ctx: RssPluginContext): PluginListView {
  const feeds = loadFeeds(ctx);
  const items: PluginListItem[] = feeds.map((feed) => ({
    id: feed.url,
    title: feed.title,
    subtitle: feed.url,
    icon: "globe",
    // Find a feed by what it published; the host caps keywords at 40.
    keywords: feed.articles.slice(0, 40).map((article) => article.title),
    accessories: [
      {
        kind: "tag",
        text: `${feed.articles.length} article${feed.articles.length === 1 ? "" : "s"}`,
      },
      ...(formatWhen(ctx, feed.lastFetched, "date")
        ? [{ kind: "text" as const, text: formatWhen(ctx, feed.lastFetched, "date")! }]
        : []),
    ],
    onSelect: () => ({ view: feedDetailView(ctx, feed) }),
  }));

  return {
    kind: "list",
    searchable: feeds.length > 5,
    searchPlaceholder: "Search subscriptions",
    emptyText: "No subscriptions yet — add your first feed.",
    items,
    actions: [
      {
        id: "add",
        label: "Add feed",
        icon: "plus",
        run: () => ({ view: addFeedView(ctx) }),
      },
      {
        id: "import",
        label: "Import OPML",
        icon: "download-simple",
        run: () => ({ view: importOpmlView(ctx) }),
      },
      ...(feeds.length > 0
        ? [
            {
              id: "refresh-all",
              label: "Refresh all",
              icon: "arrows-clockwise",
              run: async () => ({
                toast: await refreshAllFeeds(ctx),
                view: rssPageView(ctx),
                navigation: "replace" as const,
              }),
            },
          ]
        : []),
    ],
  };
}
