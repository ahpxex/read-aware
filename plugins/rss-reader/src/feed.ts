import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { FeedArticle, FeedResult, RssPluginContext } from "./types";
import { MAX_ARTICLES } from "./types";
import { digest } from "./identity";

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
  if (!value.trim()) return undefined;
  try {
    const link = new URL(value, feedUrl);
    return link.protocol === "http:" || link.protocol === "https:" ? link.toString() : undefined;
  } catch {
    return undefined;
  }
}

// The plugin sandbox is a Worker — no DOMParser there. Feeds parse through
// fast-xml-parser (pure JS, bundled into main.js), which also makes this
// module testable off the DOM.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep every text node a string — "0123" must not become 123.
  parseTagValue: false,
  // Feeds routinely entity-escape embedded HTML (&lt;p&gt;…); decode it the
  // way DOM .textContent used to.
  htmlEntities: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/** Element text: a plain string, or the `#text` of an attributed element. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    return textOf((value as Record<string, unknown>)["#text"]);
  }
  return "";
}

function firstText(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = textOf(item[key]);
    if (value) return value;
  }
  return "";
}

/** An Atom entry's alternate link href (or its first link without a rel). */
function atomLink(value: unknown): string {
  const links = asArray(value as Record<string, unknown> | Record<string, unknown>[]);
  const preferred =
    links.find(
      (link) =>
        link && typeof link === "object" &&
        ((link as Record<string, unknown>)["@_rel"] === "alternate" ||
          (link as Record<string, unknown>)["@_rel"] === undefined),
    ) ?? links[0];
  if (!preferred) return "";
  if (typeof preferred === "string") return preferred;
  const href = (preferred as Record<string, unknown>)["@_href"];
  return typeof href === "string" ? href.trim() : "";
}

type FeedShape = {
  kind: "rss" | "atom";
  title: string;
  items: Record<string, unknown>[];
};

/** Locate the channel in an RSS 2.0, RSS 1.0 (RDF), or Atom document. */
function feedShape(doc: Record<string, unknown>): FeedShape | null {
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    return {
      kind: "rss",
      title: textOf(channel.title),
      items: asArray(channel.item as Record<string, unknown> | Record<string, unknown>[]),
    };
  }
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  if (rdf) {
    const rdfChannel = rdf.channel as Record<string, unknown> | undefined;
    return {
      kind: "rss",
      title: textOf(rdfChannel?.title),
      items: asArray(rdf.item as Record<string, unknown> | Record<string, unknown>[]),
    };
  }
  const atom = doc.feed as Record<string, unknown> | undefined;
  if (atom) {
    return {
      kind: "atom",
      title: textOf(atom.title),
      items: asArray(atom.entry as Record<string, unknown> | Record<string, unknown>[]),
    };
  }
  return null;
}

/** The declared `articleLimit` setting, defended back to the default. */
function articleLimit(ctx: RssPluginContext): number {
  const settings = ctx.services.storage.get<Record<string, unknown>>("settings");
  const value = settings?.articleLimit;
  return typeof value === "number" && value >= 5 && value <= 100
    ? Math.floor(value)
    : MAX_ARTICLES;
}

export async function parseFeed(
  xmlText: string,
  feedUrl: string,
  limit = MAX_ARTICLES,
): Promise<FeedResult> {
  if (new TextEncoder().encode(xmlText).byteLength > 4 * 1024 * 1024) {
    throw Object.assign(new Error("Feed XML exceeds 4 MiB"), { code: "plugin/payload-too-large" });
  }
  if (XMLValidator.validate(xmlText) !== true) {
    throw new Error("Not a valid RSS/Atom feed");
  }
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(xmlText) as Record<string, unknown>;
  } catch {
    throw new Error("Not a valid RSS/Atom feed");
  }
  const shape = feedShape(doc);
  if (!shape) throw new Error("Not a valid RSS/Atom feed");

  const title = shape.title || feedUrl;
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : MAX_ARTICLES;

  const articles: FeedArticle[] = [];
  const sections: FeedResult["content"]["sections"] = [];
  const seen = new Set<string>();
  for (const item of shape.items) {
    if (articles.length >= count) break;
    const index = articles.length;
    const articleTitle = textOf(item.title) || `Article ${index + 1}`;
    const body =
      (shape.kind === "atom"
        ? firstText(item, "content", "summary")
        : firstText(item, "content:encoded", "description")) ||
      "<p>(no content in feed)</p>";
    const rawLink =
      shape.kind === "atom" ? atomLink(item.link) : firstText(item, "link");
    const link = resolveArticleLink(rawLink, feedUrl);
    const publishedAt =
      (shape.kind === "atom"
        ? firstText(item, "published", "updated")
        : firstText(item, "pubDate", "dc:date")) || undefined;
    const publishedDate = publishedAt ? new Date(publishedAt) : null;
    const publishedAtIso =
      publishedDate && !Number.isNaN(publishedDate.getTime())
        ? publishedDate.toISOString()
        : undefined;
    const declaredId = shape.kind === "atom" ? firstText(item, "id") : firstText(item, "guid", "@_rdf:about");
    const identity = declaredId ? ["id", declaredId] : link ? ["link", link]
      : ["content", textOf(item.title), publishedAt ?? "", body];
    const id = `article-${await digest(JSON.stringify([feedUrl, ...identity]))}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const header = [
      publishedAt ? `<p><em>${escapeHtml(publishedAt)}</em></p>` : "",
      link ? `<p><a href="${escapeHtml(link)}">Read on the web</a></p>` : "",
    ].join("");

    articles.push({ id, title: articleTitle, link, publishedAt, publishedAtIso });
    sections.push({ id, title: articleTitle, html: `${header}${body}` });
  }

  return {
    title,
    articles,
    content: { title, author: "RSS", language: "en", sections },
  };
}

export async function fetchFeed(ctx: RssPluginContext, url: string): Promise<FeedResult> {
  const response = await ctx.services.network.fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const status = response.status;
    const code = status === 401 || status === 403 ? "plugin/http-auth"
      : status === 404 || status === 410 ? "plugin/http-not-found"
      : status === 429 ? "plugin/http-rate-limited"
      : status >= 500 ? "plugin/http-server" : "plugin/http-rejected";
    try { await response.body?.cancel(); }
    catch (error) { console.warn("RSS rejected response cleanup failed", error); }
    throw Object.assign(new Error(`Feed returned ${status}`), { code, retryable: status === 429 || status >= 500 });
  }
  return parseFeed(await response.text(), url, articleLimit(ctx));
}
