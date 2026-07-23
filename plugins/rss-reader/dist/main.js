// src/types.ts
var PROVIDER_ID = "feed";
var MAX_ARTICLES = 30;
function assertPluginCapabilities(ctx) {
  if (!ctx.network)
    throw new Error('RSS Reader requires the "service:network" permission');
  if (!ctx.books?.write)
    throw new Error('RSS Reader requires the "books:write" permission');
  if (!ctx.agent)
    throw new Error('RSS Reader requires the "agent:tools" permission');
}

// src/storage.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function readArticle(value) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    link: typeof value.link === "string" ? value.link : undefined,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : undefined
  };
}
function readFeed(value) {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.title !== "string" || typeof value.bookId !== "string") {
    return null;
  }
  const articles = Array.isArray(value.articles) ? value.articles.map(readArticle).filter((article) => article !== null) : [];
  return {
    url: value.url,
    title: value.title,
    bookId: value.bookId,
    addedAt: typeof value.addedAt === "string" ? value.addedAt : "",
    lastFetched: typeof value.lastFetched === "string" ? value.lastFetched : "",
    articles
  };
}
function loadFeeds(ctx) {
  const stored = ctx.storage.get("feeds");
  return Array.isArray(stored) ? stored.map(readFeed).filter((feed) => feed !== null) : [];
}
function saveFeeds(ctx, feeds) {
  ctx.storage.set("feeds", feeds);
}
function upsertFeed(ctx, feed) {
  saveFeeds(ctx, [feed, ...loadFeeds(ctx).filter((entry) => entry.url !== feed.url)]);
}

// src/feed.ts
function isHttpFeedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function resolveArticleLink(value, feedUrl) {
  try {
    const link = new URL(value, feedUrl);
    return link.protocol === "http:" || link.protocol === "https:" ? link.toString() : undefined;
  } catch {
    return;
  }
}
function pick(parent, ...selectors) {
  for (const selector of selectors) {
    const value = parent.querySelector(selector)?.textContent?.trim();
    if (value)
      return value;
  }
  return "";
}
function parseFeed(xmlText, feedUrl) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("Not a valid RSS/Atom feed");
  }
  const isAtom = xml.querySelector("feed > entry") !== null;
  const title = (isAtom ? pick(xml, "feed > title") : pick(xml, "channel > title")) || feedUrl;
  const items = Array.from(xml.querySelectorAll(isAtom ? "feed > entry" : "channel > item")).slice(0, MAX_ARTICLES);
  const articles = [];
  const sections = items.map((item, index) => {
    const articleTitle = pick(item, "title") || `Article ${index + 1}`;
    const encoded = item.getElementsByTagName("content:encoded")[0]?.textContent ?? "";
    const body = encoded.trim() || pick(item, "content", "summary", "description") || "<p>(no content in feed)</p>";
    const rawLink = isAtom ? item.querySelector("link")?.getAttribute("href") ?? "" : pick(item, "link");
    const link = resolveArticleLink(rawLink, feedUrl);
    const publishedAt = pick(item, "pubDate", "published", "updated") || undefined;
    const id = `article-${index}`;
    const header = [
      publishedAt ? `<p><em>${escapeHtml(publishedAt)}</em></p>` : "",
      link ? `<p><a href="${escapeHtml(link)}">Read on the web</a></p>` : ""
    ].join("");
    articles.push({ id, title: articleTitle, link, publishedAt });
    return { id, title: articleTitle, html: `${header}${body}` };
  });
  return {
    title,
    articles,
    content: { title, author: "RSS", language: "en", sections }
  };
}
async function fetchFeed(ctx, url) {
  const response = await ctx.network.fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(`Feed returned ${response.status}`);
  return parseFeed(await response.text(), url);
}
async function ensureBook(ctx, feed) {
  const book = await ctx.books.write.addVirtualBook({
    providerId: PROVIDER_ID,
    key: feed.url,
    title: feed.title,
    author: "RSS"
  });
  if (book.id === feed.bookId)
    return feed;
  const healed = { ...feed, bookId: book.id };
  upsertFeed(ctx, healed);
  return healed;
}
async function subscribe(ctx, rawUrl) {
  const url = rawUrl.trim();
  if (!isHttpFeedUrl(url))
    throw new Error("Enter a valid http(s) feed URL");
  const existing = loadFeeds(ctx).find((feed2) => feed2.url === url);
  const { title, articles } = await fetchFeed(ctx, url);
  const book = await ctx.books.write.addVirtualBook({
    providerId: PROVIDER_ID,
    key: url,
    title,
    author: "RSS"
  });
  const now = new Date().toISOString();
  const feed = {
    url,
    title,
    bookId: book.id,
    addedAt: existing?.addedAt || now,
    lastFetched: now,
    articles
  };
  upsertFeed(ctx, feed);
  return feed;
}

// src/agent-tools.ts
function feedToolLimit(value) {
  return typeof value === "number" && value > 0 ? Math.min(30, Math.floor(value)) : 10;
}
function registerAgentTools(ctx) {
  ctx.agent.registerTool({
    name: "list_feeds",
    label: "RSS subscriptions",
    description: "List the reader's RSS subscriptions and their recently cached article titles. Call without arguments to inspect the RSS backlog.",
    parameters: {
      type: "object",
      properties: {
        articleLimit: {
          type: "number",
          description: "Maximum recent article titles per feed (default 10, max 30)."
        }
      },
      additionalProperties: false
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
          publishedAt: article.publishedAt
        }))
      }));
    }
  });
  ctx.agent.registerTool({
    name: "subscribe_feed",
    label: "Subscribe to RSS",
    description: "Subscribe to an RSS or Atom feed and add it to the shelf as a readable book.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) RSS or Atom feed URL." }
      },
      required: ["url"],
      additionalProperties: false
    },
    execute: async (params) => {
      const url = typeof params.url === "string" ? params.url.trim() : "";
      const existing = loadFeeds(ctx).find((feed2) => feed2.url === url);
      if (existing) {
        return { subscribed: false, reason: "already subscribed", feed: existing.title };
      }
      const feed = await subscribe(ctx, url);
      return {
        subscribed: true,
        title: feed.title,
        url: feed.url,
        bookId: feed.bookId,
        articles: feed.articles.length
      };
    }
  });
  ctx.agent.registerTool({
    name: "refresh_feed",
    label: "Refresh RSS feed",
    description: "Refresh one existing RSS subscription and return its latest cached article titles.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The exact URL of an existing RSS subscription." }
      },
      required: ["url"],
      additionalProperties: false
    },
    execute: async (params) => {
      const url = typeof params.url === "string" ? params.url.trim() : "";
      if (!loadFeeds(ctx).some((feed2) => feed2.url === url)) {
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
          publishedAt: article.publishedAt
        }))
      };
    }
  });
}

// src/opml.ts
function feedUrlsFromOpml(text) {
  const xml = new DOMParser().parseFromString(text, "text/xml");
  if (xml.querySelector("parsererror"))
    return [];
  return Array.from(xml.querySelectorAll("outline[xmlUrl]")).map((node) => node.getAttribute("xmlUrl")?.trim() ?? "").filter(isHttpFeedUrl);
}

// src/views.ts
function updatedLabel(value) {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}
function feedDetailView(ctx, feed) {
  const articleItems = feed.articles.map((article) => ({
    id: article.id,
    title: article.title,
    subtitle: article.publishedAt,
    icon: "article",
    onSelect: async () => {
      const healed = await ensureBook(ctx, feed);
      ctx.reader.goTo({ bookId: healed.bookId, href: article.id });
      return { close: true };
    }
  }));
  return {
    kind: "blocks",
    title: feed.title,
    blocks: [
      {
        kind: "keyValue",
        rows: [
          { label: "Feed", value: feed.url },
          { label: "Articles", value: String(feed.articles.length) },
          { label: "Updated", value: updatedLabel(feed.lastFetched) }
        ]
      },
      {
        kind: "actions",
        actions: [
          {
            id: "open",
            label: "Open as book",
            icon: "book-open",
            variant: "solid",
            run: async () => {
              const healed = await ensureBook(ctx, feed);
              ctx.reader.openBook(healed.bookId);
              return { close: true };
            }
          },
          {
            id: "refresh",
            label: "Refresh",
            run: async () => {
              const fresh = await subscribe(ctx, feed.url);
              return { toast: "Feed refreshed", view: feedDetailView(ctx, fresh) };
            }
          },
          {
            id: "remove",
            label: "Unsubscribe",
            variant: "danger",
            run: async () => {
              await ctx.books.write.removeVirtualBook({
                providerId: PROVIDER_ID,
                key: feed.url
              });
              saveFeeds(ctx, loadFeeds(ctx).filter((entry) => entry.url !== feed.url));
              return { toast: `Unsubscribed “${feed.title}”`, view: rssPageView(ctx) };
            }
          }
        ]
      },
      { kind: "divider" },
      { kind: "heading", text: "Articles", caption: "Open one to jump straight to it" },
      {
        kind: "list",
        emptyText: "Refresh to load articles.",
        items: articleItems
      }
    ]
  };
}
function rssPageView(ctx) {
  const feeds = loadFeeds(ctx);
  const total = feeds.reduce((sum, feed) => sum + feed.articles.length, 0);
  const feedItems = feeds.map((feed) => ({
    id: feed.url,
    title: feed.title,
    subtitle: `${feed.articles.length} articles · ${feed.url}`,
    icon: "globe",
    onSelect: () => ({ view: feedDetailView(ctx, feed) })
  }));
  const blocks = [
    {
      kind: "heading",
      text: "Subscriptions",
      caption: `${feeds.length} feed${feeds.length === 1 ? "" : "s"} · ${total} articles cached`
    },
    {
      kind: "form",
      fields: [
        {
          kind: "text",
          id: "url",
          label: "Feed URL",
          placeholder: "https://example.com/feed.xml",
          inputMode: "url"
        }
      ],
      submitLabel: "Subscribe",
      onSubmit: async (values) => {
        const url = String(values.url ?? "").trim();
        if (!isHttpFeedUrl(url)) {
          return { fieldErrors: { url: "Enter a valid http(s) feed URL" } };
        }
        if (loadFeeds(ctx).some((feed2) => feed2.url === url)) {
          return { fieldErrors: { url: "Already subscribed" } };
        }
        const feed = await subscribe(ctx, url);
        return { toast: `Subscribed to “${feed.title}”`, view: rssPageView(ctx) };
      }
    },
    { kind: "divider" },
    {
      kind: "list",
      emptyText: "No subscriptions yet — add a feed above.",
      items: feedItems
    }
  ];
  if (feeds.length > 0) {
    blocks.push({
      kind: "actions",
      actions: [
        {
          id: "refresh-all",
          label: "Refresh all",
          icon: "arrow-square-out",
          run: async () => {
            for (const feed of loadFeeds(ctx)) {
              try {
                await subscribe(ctx, feed.url);
              } catch {}
            }
            return { toast: "All feeds refreshed", view: rssPageView(ctx) };
          }
        }
      ]
    });
  }
  blocks.push({ kind: "divider" }, { kind: "heading", text: "Import", caption: "Paste an OPML export to bulk-subscribe" }, {
    kind: "form",
    fields: [{ kind: "textarea", id: "opml", label: "OPML", rows: 4 }],
    submitLabel: "Import",
    onSubmit: async (values) => {
      const text = String(values.opml ?? "").trim();
      if (!text)
        return { fieldErrors: { opml: "Paste OPML XML first" } };
      const urls = feedUrlsFromOpml(text);
      if (urls.length === 0) {
        return { fieldErrors: { opml: "No feed URLs found in this OPML" } };
      }
      let added = 0;
      for (const url of urls) {
        if (loadFeeds(ctx).some((feed) => feed.url === url))
          continue;
        try {
          await subscribe(ctx, url);
          added += 1;
        } catch {}
      }
      return { toast: `Imported ${added} of ${urls.length} feeds`, view: rssPageView(ctx) };
    }
  });
  return { kind: "blocks", blocks };
}

// src/index.ts
var plugin = {
  activate(ctx) {
    assertPluginCapabilities(ctx);
    ctx.books.write.registerContentProvider({
      id: PROVIDER_ID,
      load: async (url) => (await fetchFeed(ctx, url)).content
    });
    ctx.ui.registerHeaderAction({
      id: "feeds",
      title: "RSS Feeds",
      icon: "globe",
      surface: "shelf",
      presentation: "page",
      view: () => rssPageView(ctx)
    });
    ctx.books.on("book.removed", ({ payload: { bookId } }) => {
      const feeds = loadFeeds(ctx);
      const feed = feeds.find((entry) => entry.bookId === bookId);
      if (!feed)
        return;
      saveFeeds(ctx, feeds.filter((entry) => entry.url !== feed.url));
      ctx.ui.showToast(`Unsubscribed “${feed.title}”`);
    });
    ctx.ui.registerCommand({
      id: "subscribe",
      title: "RSS: subscriptions",
      icon: "globe",
      keywords: "rss atom feed subscribe",
      run: () => ({ view: rssPageView(ctx) })
    });
    registerAgentTools(ctx);
  }
};
var src_default = plugin;
export {
  src_default as default
};
