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

type LibraryWithCommands = NonNullable<PluginContext["domains"]["library"]> & {
  commands: NonNullable<
    NonNullable<PluginContext["domains"]["library"]>["commands"]
  >;
};

type ReadingWithCommands = NonNullable<PluginContext["domains"]["reading"]> & {
  commands: NonNullable<
    NonNullable<PluginContext["domains"]["reading"]>["commands"]
  >;
};

export type RssPluginContext = PluginContext & {
  domains: PluginContext["domains"] & {
    library: LibraryWithCommands;
    reading: ReadingWithCommands;
  };
  contributions: PluginContext["contributions"] & {
    agentTools: NonNullable<PluginContext["contributions"]["agentTools"]>;
  };
  services: PluginContext["services"] & {
    network: NonNullable<PluginContext["services"]["network"]>;
  };
};

export function assertPluginCapabilities(ctx: PluginContext): asserts ctx is RssPluginContext {
  if (!ctx.services.network) throw new Error('RSS Reader requires the "service:network" permission');
  if (!ctx.domains.library?.commands) throw new Error('RSS Reader requires the "library:write" permission');
  if (!ctx.domains.reading?.commands) throw new Error('RSS Reader requires the "reading:write" permission');
  if (!ctx.contributions.agentTools) throw new Error('RSS Reader requires the "agent:tools" permission');
}
