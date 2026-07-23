import type { FeedArticle, FeedResult, FeedSubscription, RssPluginContext } from "./types";
import { MAX_ARTICLES, PROVIDER_ID } from "./types";
import { loadFeeds, upsertFeed } from "./storage";

export function isHttpFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveArticleLink(value: string, feedUrl: string): string | undefined {
  try {
    const link = new URL(value, feedUrl);
    return link.protocol === "http:" || link.protocol === "https:" ? link.toString() : undefined;
  } catch {
    return undefined;
  }
}

function pick(parent: ParentNode, ...selectors: string[]): string {
  for (const selector of selectors) {
    const value = parent.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

export function parseFeed(xmlText: string, feedUrl: string): FeedResult {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("Not a valid RSS/Atom feed");
  }

  const isAtom = xml.querySelector("feed > entry") !== null;
  const title = (isAtom ? pick(xml, "feed > title") : pick(xml, "channel > title")) || feedUrl;
  const items = Array.from(
    xml.querySelectorAll(isAtom ? "feed > entry" : "channel > item"),
  ).slice(0, MAX_ARTICLES);

  const articles: FeedArticle[] = [];
  const sections = items.map((item, index) => {
    const articleTitle = pick(item, "title") || `Article ${index + 1}`;
    const encoded = item.getElementsByTagName("content:encoded")[0]?.textContent ?? "";
    const body =
      encoded.trim() ||
      pick(item, "content", "summary", "description") ||
      "<p>(no content in feed)</p>";
    const rawLink = isAtom
      ? (item.querySelector("link")?.getAttribute("href") ?? "")
      : pick(item, "link");
    const link = resolveArticleLink(rawLink, feedUrl);
    const publishedAt = pick(item, "pubDate", "published", "updated") || undefined;
    const id = `article-${index}`;
    const header = [
      publishedAt ? `<p><em>${escapeHtml(publishedAt)}</em></p>` : "",
      link ? `<p><a href="${escapeHtml(link)}">Read on the web</a></p>` : "",
    ].join("");

    articles.push({ id, title: articleTitle, link, publishedAt });
    return { id, title: articleTitle, html: `${header}${body}` };
  });

  return {
    title,
    articles,
    content: { title, author: "RSS", language: "en", sections },
  };
}

export async function fetchFeed(ctx: RssPluginContext, url: string): Promise<FeedResult> {
  const response = await ctx.network.fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  return parseFeed(await response.text(), url);
}

export async function ensureBook(
  ctx: RssPluginContext,
  feed: FeedSubscription,
): Promise<FeedSubscription> {
  const book = await ctx.books.write.addVirtualBook({
    providerId: PROVIDER_ID,
    key: feed.url,
    title: feed.title,
    author: "RSS",
  });
  if (book.id === feed.bookId) return feed;

  const healed = { ...feed, bookId: book.id };
  upsertFeed(ctx, healed);
  return healed;
}

export async function subscribe(
  ctx: RssPluginContext,
  rawUrl: string,
): Promise<FeedSubscription> {
  const url = rawUrl.trim();
  if (!isHttpFeedUrl(url)) throw new Error("Enter a valid http(s) feed URL");

  const existing = loadFeeds(ctx).find((feed) => feed.url === url);
  const { title, articles } = await fetchFeed(ctx, url);
  const book = await ctx.books.write.addVirtualBook({
    providerId: PROVIDER_ID,
    key: url,
    title,
    author: "RSS",
  });
  const now = new Date().toISOString();
  const feed: FeedSubscription = {
    url,
    title,
    bookId: book.id,
    addedAt: existing?.addedAt || now,
    lastFetched: now,
    articles,
  };
  upsertFeed(ctx, feed);
  return feed;
}
