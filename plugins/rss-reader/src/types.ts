import type { PluginBookContent, PluginContext } from "@read-aware/plugin-types";

export const PROVIDER_ID = "feed";
export const MAX_ARTICLES = 30;

export type FeedArticle = {
  id: string;
  title: string;
  link?: string;
  /** The date string exactly as the feed carried it (shown in book content). */
  publishedAt?: string;
  /** Parsed ISO form for host-side lists; absent when unparseable. */
  publishedAtIso?: string;
};

export type FeedSubscription = {
  url: string;
  title: string;
  bookId: string;
  addedAt: string;
  lastFetched: string;
  articles: FeedArticle[];
};

export type FeedResult = {
  title: string;
  articles: FeedArticle[];
  content: PluginBookContent;
};

type ShelfWithWrite = NonNullable<PluginContext["shelf"]> & {
  books: NonNullable<PluginContext["shelf"]>["books"] & {
    write: NonNullable<NonNullable<PluginContext["shelf"]>["books"]["write"]>;
  };
};

export type RssPluginContext = PluginContext & {
  shelf: ShelfWithWrite;
  network: NonNullable<PluginContext["network"]>;
  agent: NonNullable<PluginContext["agent"]>;
};

export function assertPluginCapabilities(ctx: PluginContext): asserts ctx is RssPluginContext {
  if (!ctx.network) throw new Error('RSS Reader requires the "service:network" permission');
  if (!ctx.shelf?.books.write) throw new Error('RSS Reader requires the "shelf:write" permission');
  if (!ctx.agent) throw new Error('RSS Reader requires the "agent:tools" permission');
}
