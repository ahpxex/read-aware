import { subscribe } from "./feed";
import { loadFeeds } from "./storage";
import type { RssPluginContext } from "./types";

export function feedToolLimit(value: unknown): number {
  return typeof value === "number" && value > 0
    ? Math.min(30, Math.floor(value))
    : 10;
}

export function registerAgentTools(ctx: RssPluginContext): void {
  ctx.agent.registerTool({
    name: "list_feeds",
    label: "RSS subscriptions",
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
    execute: (params) => {
      const limit = feedToolLimit(params.articleLimit);
      return loadFeeds(ctx).map((feed) => ({
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

  ctx.agent.registerTool({
    name: "subscribe_feed",
    label: "Subscribe to RSS",
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
      const existing = loadFeeds(ctx).find((feed) => feed.url === url);
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

  ctx.agent.registerTool({
    name: "refresh_feed",
    label: "Refresh RSS feed",
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
      if (!loadFeeds(ctx).some((feed) => feed.url === url)) {
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
