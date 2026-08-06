/**
 * Host-rendered surfaces. The root is the subscriptions themselves — a
 * searchable list with its management commands at the list edge; adding and
 * importing are pushed forms, not permanent page furniture. Each feed opens
 * as a detail view: provenance in metadata, commands as detail actions, and
 * the articles as the content. All copy resolves against the live app locale.
 */
import type {
  PluginDetailView,
  PluginFormView,
  PluginListItem,
  PluginListView,
} from "@read-aware/plugin-types";
import { ensureBook, isHttpFeedUrl, subscribe } from "./feed";
import { feedUrlsFromOpml } from "./opml";
import { articlesTag, tr } from "./strings";
import { getFeed, loadFeeds, removeFeed } from "./storage";
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

const REFRESH_CONCURRENCY = 4;

/** Refresh every subscription — a few at a time, tolerating failures. */
export async function refreshAllFeeds(ctx: RssPluginContext): Promise<string> {
  const queue = await loadFeeds(ctx);
  const total = queue.length;
  let refreshed = 0;
  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) {
        try {
          await subscribe(ctx, feed.url);
          refreshed += 1;
        } catch {
          // One unavailable feed must not prevent the others from refreshing.
        }
      }
    }),
  );
  return refreshed === total
    ? tr(ctx.locale, "refreshedAll", { n: refreshed })
    : tr(ctx.locale, "refreshedSome", { ok: refreshed, total });
}

export function addFeedView(ctx: RssPluginContext): PluginFormView {
  return {
    kind: "form",
    title: tr(ctx.locale, "addFeed"),
    fields: [
      {
        kind: "text",
        id: "url",
        label: tr(ctx.locale, "feedUrlLabel"),
        placeholder: "https://example.com/feed.xml",
        inputMode: "url",
        helperText: tr(ctx.locale, "addFeedHelper"),
      },
    ],
    submitLabel: tr(ctx.locale, "subscribe"),
    onSubmit: async (values) => {
      const url = String(values.url ?? "").trim();
      if (!isHttpFeedUrl(url)) {
        return { fieldErrors: { url: tr(ctx.locale, "invalidUrl") } };
      }
      if (await getFeed(ctx, url)) {
        return { fieldErrors: { url: tr(ctx.locale, "alreadySubscribed") } };
      }
      const feed = await subscribe(ctx, url);
      return {
        toast: tr(ctx.locale, "subscribedTo", { title: feed.title }),
        view: await rssPageView(ctx),
        navigation: "reset",
      };
    },
  };
}

export function importOpmlView(ctx: RssPluginContext): PluginFormView {
  return {
    kind: "form",
    title: tr(ctx.locale, "importOpml"),
    fields: [
      {
        kind: "textarea",
        id: "opml",
        label: "OPML",
        rows: 8,
        placeholder: "<opml version=\"2.0\">…",
        helperText: tr(ctx.locale, "opmlHelper"),
      },
    ],
    submitLabel: tr(ctx.locale, "importAction"),
    onSubmit: async (values) => {
      const text = String(values.opml ?? "").trim();
      if (!text) return { fieldErrors: { opml: tr(ctx.locale, "pasteOpml") } };

      const urls = feedUrlsFromOpml(text);
      if (urls.length === 0) {
        return { fieldErrors: { opml: tr(ctx.locale, "noUrlsInOpml") } };
      }

      let added = 0;
      for (const url of urls) {
        if (await getFeed(ctx, url)) continue;
        try {
          await subscribe(ctx, url);
          added += 1;
        } catch {
          // Report the aggregate result; inaccessible feeds remain unmodified.
        }
      }
      return {
        toast: tr(ctx.locale, "importedFeeds", { added, total: urls.length }),
        view: await rssPageView(ctx),
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
      { kind: "label", label: tr(ctx.locale, "metaFeed"), value: feed.url, icon: "globe" },
      {
        kind: "label",
        label: tr(ctx.locale, "metaUpdated"),
        value: formatWhen(ctx, feed.lastFetched, "dateTime") ?? "—",
        icon: "calendar",
      },
      {
        kind: "label",
        label: tr(ctx.locale, "metaArticles"),
        value: String(feed.articles.length),
      },
    ],
    actions: [
      {
        id: "open",
        label: tr(ctx.locale, "openAsBook"),
        icon: "book-open",
        run: async () => {
          const healed = await ensureBook(ctx, feed);
          ctx.reader.openBook(healed.bookId);
          return { close: true };
        },
      },
      {
        id: "refresh",
        label: tr(ctx.locale, "refresh"),
        icon: "arrows-clockwise",
        run: async () => {
          const fresh = await subscribe(ctx, feed.url);
          return {
            toast: tr(ctx.locale, "feedRefreshed"),
            view: feedDetailView(ctx, fresh),
            navigation: "replace",
          };
        },
      },
      {
        id: "remove",
        label: tr(ctx.locale, "unsubscribe"),
        icon: "trash",
        variant: "danger",
        run: async () => {
          await ctx.shelf.books.write.removeVirtualBook({
            providerId: PROVIDER_ID,
            key: feed.url,
          });
          await removeFeed(ctx, feed.url);
          return {
            toast: tr(ctx.locale, "unsubscribedFrom", { title: feed.title }),
            view: await rssPageView(ctx),
            navigation: "reset",
          };
        },
      },
    ],
    content: [
      {
        kind: "list",
        searchable: feed.articles.length > 8,
        searchPlaceholder: tr(ctx.locale, "searchArticles"),
        emptyText: tr(ctx.locale, "emptyArticles"),
        items: articleItems,
      },
    ],
  };
}

export async function rssPageView(ctx: RssPluginContext): Promise<PluginListView> {
  const feeds = await loadFeeds(ctx);
  const items: PluginListItem[] = feeds.map((feed) => ({
    id: feed.url,
    title: feed.title,
    subtitle: feed.url,
    icon: "globe",
    // Find a feed by what it published; the host caps keywords at 40.
    keywords: feed.articles.slice(0, 40).map((article) => article.title),
    accessories: [
      { kind: "tag", text: articlesTag(ctx.locale, feed.articles.length) },
      ...(formatWhen(ctx, feed.lastFetched, "date")
        ? [{ kind: "text" as const, text: formatWhen(ctx, feed.lastFetched, "date")! }]
        : []),
    ],
    onSelect: () => ({ view: feedDetailView(ctx, feed) }),
  }));

  return {
    kind: "list",
    searchable: feeds.length > 5,
    searchPlaceholder: tr(ctx.locale, "searchSubscriptions"),
    emptyText: tr(ctx.locale, "emptySubscriptions"),
    items,
    actions: [
      {
        id: "add",
        label: tr(ctx.locale, "addFeed"),
        icon: "plus",
        run: () => ({ view: addFeedView(ctx) }),
      },
      {
        id: "import",
        label: tr(ctx.locale, "importOpml"),
        icon: "download-simple",
        run: () => ({ view: importOpmlView(ctx) }),
      },
      ...(feeds.length > 0
        ? [
            {
              id: "refresh-all",
              label: tr(ctx.locale, "refreshAll"),
              icon: "arrows-clockwise",
              run: async () => ({
                toast: await refreshAllFeeds(ctx),
                view: await rssPageView(ctx),
                navigation: "replace" as const,
              }),
            },
          ]
        : []),
    ],
  };
}
