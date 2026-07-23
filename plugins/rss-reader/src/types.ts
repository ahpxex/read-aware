import type { PluginBookContent, PluginContext } from "@read-aware/plugin-types";

export const PROVIDER_ID = "feed";
export const MAX_ARTICLES = 30;

export type FeedArticle = {
  id: string;
  title: string;
  link?: string;
  publishedAt?: string;
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

type BooksWithWrite = NonNullable<PluginContext["books"]> & {
  write: NonNullable<NonNullable<PluginContext["books"]>["write"]>;
};

export type RssPluginContext = PluginContext & {
  books: BooksWithWrite;
  network: NonNullable<PluginContext["network"]>;
  agent: NonNullable<PluginContext["agent"]>;
};

export function assertPluginCapabilities(ctx: PluginContext): asserts ctx is RssPluginContext {
  if (!ctx.network) throw new Error('RSS Reader requires the "service:network" permission');
  if (!ctx.books?.write) throw new Error('RSS Reader requires the "books:write" permission');
  if (!ctx.agent) throw new Error('RSS Reader requires the "agent:tools" permission');
}
