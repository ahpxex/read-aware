/**
 * Subscriptions live in the plugin document collection ("feeds", one document
 * per feed keyed by its URL) — the structured tier, so a large subscription
 * list never round-trips as one KV blob. Early versions stored a single KV
 * array under "feeds"; the schema migration adopts it before activation.
 */
import type { PluginMigrationStorage } from "@read-aware/plugin-types";
import type { FeedArticle, FeedSubscription } from "./types";

const COLLECTION = "feeds";

type StorageCtx = {
  services: { storage: PluginMigrationStorage };
};

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
    publishedAtIso:
      typeof value.publishedAtIso === "string" ? value.publishedAtIso : undefined,
  };
}

export function readFeed(value: unknown): FeedSubscription | null {
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

/** All subscriptions, newest write first (the collection's natural order). */
export async function loadFeeds(ctx: StorageCtx): Promise<FeedSubscription[]> {
  const documents = await ctx.services.storage.collection(COLLECTION).list<unknown>({ limit: 1000 });
  return documents
    .map((document) => readFeed(document.data))
    .filter((feed): feed is FeedSubscription => feed !== null);
}

export async function getFeed(
  ctx: StorageCtx,
  url: string,
): Promise<FeedSubscription | null> {
  const document = await ctx.services.storage.collection(COLLECTION).get<unknown>(url);
  return document ? readFeed(document.data) : null;
}

export async function upsertFeed(ctx: StorageCtx, feed: FeedSubscription): Promise<void> {
  await ctx.services.storage.collection(COLLECTION).put(feed.url, feed, { bookId: feed.bookId });
}

export async function removeFeed(ctx: StorageCtx, url: string): Promise<void> {
  await ctx.services.storage.collection(COLLECTION).delete(url);
}

/**
 * One-time adoption of the pre-0.7 KV array. Documents win on collision (a
 * partially migrated install must not regress), and the KV key is removed
 * only after every entry landed.
 */
export async function migrateLegacyFeeds(ctx: StorageCtx): Promise<void> {
  const legacy = ctx.services.storage.get<unknown>("feeds");
  if (!Array.isArray(legacy)) return;
  for (const raw of legacy) {
    const feed = readFeed(raw);
    if (!feed) continue;
    const existing = await getFeed(ctx, feed.url);
    if (!existing) await upsertFeed(ctx, feed);
  }
  ctx.services.storage.remove("feeds");
}
