import { subscribe, unsubscribeFeed } from "./feed-library";
import { getFeed, loadFeeds } from "./storage";
import type { RssPluginContext } from "./types";
import { importOpml } from "./opml-import";

export function feedToolLimit(value: unknown): number {
  return typeof value === "number" && value > 0
    ? Math.min(30, Math.floor(value))
    : 10;
}

export function registerAgentTools(ctx: RssPluginContext): void {
  ctx.contributions.agentTools.register({
    name: "import_opml", label: "Import OPML", contexts: ["global"], approval: "required",
    description: "Import one page of RSS/Atom subscriptions from user-provided OPML XML after host approval. Fetches the selected feed URLs and adds virtual books with cached articles. Existing subscriptions are skipped, not refreshed. Each page is separately approved; pass the unchanged XML and returned nextOffset to continue. Results distinguish added/existing/failed; failures may have persisted a subscription or pending source notification, so this is not an atomic transaction. XML input is at most 8000 characters for the confirmation surface; larger files use the RSS plugin's native file-import action. Does not open a book, change the current reading position or remove existing subscriptions.",
    parameters: { type: "object", properties: {
      opml: { type: "string", minLength: 1, maxLength: 8000 },
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 },
    }, required: ["opml"], additionalProperties: false },
    execute: async params => {
      if (typeof params.opml !== "string" || !params.opml.trim() || params.opml.length > 8000) {
        throw Object.assign(new Error("Invalid OPML tool input"), { code: "plugin/invalid-input" });
      }
      return importOpml(ctx, params.opml, params.offset === undefined ? 0 : params.offset as number, params.limit === undefined ? 10 : params.limit as number);
    },
  });
  ctx.contributions.agentTools.register({
    name: "unsubscribe_feed", label: "Unsubscribe from RSS", contexts: ["global"], approval: "required",
    description: "Unsubscribe from this exact RSS URL and bookId returned by list_feeds. Removes the virtual book, its associated reading data and plugin-cached articles. This cannot be undone. A recreated subscription with a different bookId is refused.",
    parameters: { type: "object", properties: {
      url: { type: "string", minLength: 1, maxLength: 2048 }, bookId: { type: "string", minLength: 1, maxLength: 256 },
    }, required: ["url", "bookId"], additionalProperties: false },
    execute: async params => {
      if (typeof params.url !== "string" || !params.url.trim() || params.url.length > 2048
        || typeof params.bookId !== "string" || !params.bookId.trim() || params.bookId.length > 256) {
        throw Object.assign(new Error("Invalid RSS subscription target"), { code: "plugin/invalid-input" });
      }
      await unsubscribeFeed(ctx, params.url.trim(), params.bookId);
      return { unsubscribed: true, url: params.url.trim(), bookId: params.bookId };
    },
  });
  ctx.contributions.agentTools.register({
    name: "list_feeds",
    label: "RSS subscriptions",
    contexts: ["global"],
    description:
      "List the reader's RSS subscriptions and their recently cached article titles. Call without arguments to inspect the RSS backlog.",
    parameters: {
      type: "object",
      properties: {
        articleLimit: {
          type: "number",
          description: "Maximum recent article titles per feed (default 10, max 30).",
        },
      },
      additionalProperties: false,
    },
    execute: async (params) => {
      const limit = feedToolLimit(params.articleLimit);
      return (await loadFeeds(ctx)).map((feed) => ({
        title: feed.title,
        url: feed.url,
        bookId: feed.bookId,
        lastFetched: feed.lastFetched,
        articleCount: feed.articles.length,
        articles: feed.articles.slice(0, limit).map((article) => ({
          title: article.title,
          link: article.link,
          publishedAt: article.publishedAt,
        })),
      }));
    },
  });

  ctx.contributions.agentTools.register({
    name: "subscribe_feed",
    label: "Subscribe to RSS",
    contexts: ["global"],
    description: "Subscribe to an RSS or Atom feed and add it to the shelf as a readable book.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) RSS or Atom feed URL." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (params) => {
      const url = typeof params.url === "string" ? params.url.trim() : "";
      const existing = await getFeed(ctx, url);
      if (existing) {
        return { subscribed: false, reason: "already subscribed", feed: existing.title };
      }
      const feed = await subscribe(ctx, url);
      return {
        subscribed: true,
        title: feed.title,
        url: feed.url,
        bookId: feed.bookId,
        articles: feed.articles.length,
      };
    },
  });

  ctx.contributions.agentTools.register({
    name: "refresh_feed",
    label: "Refresh RSS feed",
    contexts: ["global"],
    description: "Refresh one existing RSS subscription and return its latest cached article titles.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The exact URL of an existing RSS subscription." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (params) => {
      const url = typeof params.url === "string" ? params.url.trim() : "";
      if (!(await getFeed(ctx, url))) {
        throw new Error("RSS subscription not found");
      }
      const feed = await subscribe(ctx, url);
      return {
        title: feed.title,
        url: feed.url,
        lastFetched: feed.lastFetched,
        articles: feed.articles.map((article) => ({
          title: article.title,
          link: article.link,
          publishedAt: article.publishedAt,
        })),
      };
    },
  });
}
