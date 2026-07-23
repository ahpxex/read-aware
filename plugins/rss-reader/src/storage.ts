import type { PluginContext } from "@read-aware/plugin-types";
import type { FeedArticle, FeedSubscription } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readArticle(value: unknown): FeedArticle | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    link: typeof value.link === "string" ? value.link : undefined,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : undefined,
  };
}

function readFeed(value: unknown): FeedSubscription | null {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.bookId !== "string"
  ) {
    return null;
  }
  const articles = Array.isArray(value.articles)
    ? value.articles.map(readArticle).filter((article): article is FeedArticle => article !== null)
    : [];

  return {
    url: value.url,
    title: value.title,
    bookId: value.bookId,
    addedAt: typeof value.addedAt === "string" ? value.addedAt : "",
    lastFetched: typeof value.lastFetched === "string" ? value.lastFetched : "",
    articles,
  };
}

export function loadFeeds(ctx: Pick<PluginContext, "storage">): FeedSubscription[] {
  const stored = ctx.storage.get<unknown>("feeds");
  return Array.isArray(stored)
    ? stored.map(readFeed).filter((feed): feed is FeedSubscription => feed !== null)
    : [];
}

export function saveFeeds(
  ctx: Pick<PluginContext, "storage">,
  feeds: FeedSubscription[],
): void {
  ctx.storage.set("feeds", feeds);
}

export function upsertFeed(
  ctx: Pick<PluginContext, "storage">,
  feed: FeedSubscription,
): void {
  saveFeeds(ctx, [feed, ...loadFeeds(ctx).filter((entry) => entry.url !== feed.url)]);
}
