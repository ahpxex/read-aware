import { fetchFeed, isHttpFeedUrl } from "./feed";
import { cachedContent, discardUnreferencedContent, storeContent } from "./content-cache";
import { getFeed, loadFeeds, removeFeed, upsertFeed } from "./storage";
import { PROVIDER_ID, type FeedSubscription, type RssPluginContext } from "./types";

const queues = new WeakMap<RssPluginContext, Map<string, Promise<unknown>>>();
function serial<T>(ctx: RssPluginContext, url: string, work: () => Promise<T>): Promise<T> {
  let queue = queues.get(ctx);
  if (!queue) { queue = new Map(); queues.set(ctx, queue); }
  const next = (queue.get(url) ?? Promise.resolve()).catch(() => { /* A failed operation must not block later explicit retries. */ }).then(work);
  queue.set(url, next);
  const cleanup = () => { if (queue.get(url) === next) queue.delete(url); };
  void next.then(cleanup, cleanup);
  return next;
}

async function saveRefresh(ctx: RssPluginContext, url: string, notify: boolean): Promise<FeedSubscription> {
  const existing = await getFeed(ctx, url);
  const { title, articles, content } = await fetchFeed(ctx, url);
  const book = await ctx.domains.library.commands.books.addVirtualBook({ providerId: PROVIDER_ID, key: url, title, author: "RSS" });
  const contentId = await storeContent(ctx, url, content, book.id);
  const now = new Date().toISOString();
  const pending = notify && (contentId !== existing?.contentId || existing.contentPending === true);
  let feed: FeedSubscription = { url, title, bookId: book.id, addedAt: existing?.addedAt || now, lastFetched: now, articles, contentId,
    ...(pending ? { contentPending: true } : {}) };
  try { await upsertFeed(ctx, feed); }
  catch (error) {
    if (contentId !== existing?.contentId) await discardUnreferencedContent(ctx, contentId);
    throw error;
  }
  try {
    if (pending) {
      await ctx.domains.library.commands.books.invalidateVirtualBook({ providerId: PROVIDER_ID, key: url });
      const { contentPending: _pending, ...published } = feed;
      await upsertFeed(ctx, published); feed = published;
    }
  } finally {
    if (existing?.contentId && existing.contentId !== contentId) await discardUnreferencedContent(ctx, existing.contentId);
  }
  return feed;
}

export function subscribe(ctx: RssPluginContext, rawUrl: string): Promise<FeedSubscription> {
  const url = rawUrl.trim();
  if (!isHttpFeedUrl(url)) return Promise.reject(new Error("Enter a valid http(s) feed URL"));
  return serial(ctx, url, () => saveRefresh(ctx, url, true));
}

export function ensureBook(ctx: RssPluginContext, input: FeedSubscription): Promise<FeedSubscription> {
  return serial(ctx, input.url, async () => {
    const feed = await getFeed(ctx, input.url);
    if (!feed) throw Object.assign(new Error("RSS subscription was removed"), { code: "library/book-not-found" });
    const book = await ctx.domains.library.commands.books.addVirtualBook({ providerId: PROVIDER_ID, key: feed.url, title: feed.title, author: "RSS" });
    if (book.id === feed.bookId) return feed;
    const healed = { ...feed, bookId: book.id }; await upsertFeed(ctx, healed); return healed;
  });
}

export function loadFeedContent(ctx: RssPluginContext, url: string) {
  return serial(ctx, url, async () => {
    const feed = await getFeed(ctx, url);
    if (!feed) throw Object.assign(new Error("RSS subscription was removed"), { code: "library/book-not-found" });
    const cached = await cachedContent(ctx, feed);
    if (cached) return cached;
    // First load of a pre-cache subscription establishes its initial snapshot;
    // invalidating from inside load would reject that same reader's opening.
    const seeded = await saveRefresh(ctx, url, false);
    const content = await cachedContent(ctx, seeded);
    if (!content) throw Object.assign(new Error("RSS content was not saved"), { code: "library/content-unavailable" });
    return content;
  });
}

export function unsubscribeFeed(ctx: RssPluginContext, url: string): Promise<void> {
  return serial(ctx, url, async () => {
    await ctx.domains.library.commands.books.removeVirtualBook({ providerId: PROVIDER_ID, key: url });
    await removeFeed(ctx, url);
  });
}

export async function forgetRemovedBook(ctx: RssPluginContext, bookId: string): Promise<FeedSubscription | null> {
  const feed = (await loadFeeds(ctx)).find(feed => feed.bookId === bookId);
  if (!feed) return null;
  return serial(ctx, feed.url, async () => {
    if ((await getFeed(ctx, feed.url))?.bookId !== bookId) return null;
    await removeFeed(ctx, feed.url);
    return feed;
  });
}

export async function openFeed(ctx: RssPluginContext, input: FeedSubscription, articleId?: string): Promise<void> {
  let feed = await ensureBook(ctx, input);
  await loadFeedContent(ctx, feed.url);
  const current = await getFeed(ctx, feed.url);
  if (!current || articleId && !current.articles.some(article => article.id === articleId)) {
    throw Object.assign(new Error("RSS article no longer exists in this snapshot"), { code: "reader/target-not-found" });
  }
  feed = current;
  let session = await ctx.domains.reading.queries.session();
  if (session.bookId === feed.bookId && session.sessionId) {
    const source = await ctx.domains.library.queries.books.getContentState(feed.bookId);
    if (session.status !== "ready" || source.sourceRevision !== session.sourceRevision) {
      await ctx.domains.reading.commands.reload({ bookId: feed.bookId, sessionId: session.sessionId });
    }
  }
  await ctx.domains.reading.commands.openBook(feed.bookId);
  session = await ctx.domains.reading.queries.session();
  if (articleId) await ctx.domains.reading.commands.goTo({ bookId: feed.bookId, href: articleId, contentVersion: session.location?.contentVersion });
}
