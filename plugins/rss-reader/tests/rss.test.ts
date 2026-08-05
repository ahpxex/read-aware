import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { feedToolLimit } from "../src/agent-tools";
import { isHttpFeedUrl, parseFeed } from "../src/feed";
import { feedUrlsFromOpml } from "../src/opml";
import { loadFeeds } from "../src/storage";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>少数派</title>
    <item>
      <title>第一篇 &amp; 附录</title>
      <link>/post/1</link>
      <pubDate>Wed, 23 Jul 2026 08:00:00 GMT</pubDate>
      <description>&lt;p&gt;摘要&lt;/p&gt;</description>
      <content:encoded><![CDATA[<p>正文 <strong>加粗</strong></p>]]></content:encoded>
    </item>
    <item>
      <title>第二篇</title>
      <link>https://example.com/post/2</link>
      <description>plain</description>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>An Atom Feed</title>
  <entry>
    <title type="html">Entry One</title>
    <link rel="self" href="https://example.com/self"/>
    <link rel="alternate" href="https://example.com/entries/1"/>
    <published>2026-07-01T12:00:00Z</published>
    <content type="html">&lt;p&gt;Body&lt;/p&gt;</content>
  </entry>
</feed>`;

describe("parseFeed", () => {
  test("RSS 2.0: prefers content:encoded, resolves relative links, parses dates", () => {
    const result = parseFeed(RSS_FIXTURE, "https://sspai.com/feed");
    expect(result.title).toBe("少数派");
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0]).toMatchObject({
      id: "article-0",
      title: "第一篇 & 附录",
      link: "https://sspai.com/post/1",
      publishedAtIso: "2026-07-23T08:00:00.000Z",
    });
    expect(result.content.sections[0].html).toContain("<p>正文 <strong>加粗</strong></p>");
    // Entity-escaped description decodes to real HTML for the fallback case.
    expect(result.content.sections[1].html).toContain("plain");
    expect(result.articles[1].publishedAtIso).toBeUndefined();
  });

  test("Atom: alternate link wins, published date parses", () => {
    const result = parseFeed(ATOM_FIXTURE, "https://example.com/feed.xml");
    expect(result.title).toBe("An Atom Feed");
    expect(result.articles[0]).toMatchObject({
      title: "Entry One",
      link: "https://example.com/entries/1",
      publishedAtIso: "2026-07-01T12:00:00.000Z",
    });
    expect(result.content.sections[0].html).toContain("<p>Body</p>");
  });

  test("rejects non-feed and invalid XML", () => {
    expect(() => parseFeed("not xml at all", "https://x.example")).toThrow(/valid/);
    expect(() => parseFeed("<html><body>hi</body></html>", "https://x.example")).toThrow(
      /valid/,
    );
  });

  test("honors the article limit", () => {
    expect(parseFeed(RSS_FIXTURE, "https://sspai.com/feed", 1).articles).toHaveLength(1);
  });
});

describe("feedUrlsFromOpml", () => {
  test("collects nested outlines, dedupes, and keeps only http(s)", () => {
    const opml = `<?xml version="1.0"?>
      <opml version="2.0"><body>
        <outline text="Tech">
          <outline text="A" type="rss" xmlUrl="https://a.example/feed"/>
          <outline text="B" type="rss" xmlUrl="https://b.example/feed"/>
        </outline>
        <outline text="A again" xmlUrl="https://a.example/feed"/>
        <outline text="bad" xmlUrl="ftp://nope.example/feed"/>
      </body></opml>`;
    expect(feedUrlsFromOpml(opml)).toEqual([
      "https://a.example/feed",
      "https://b.example/feed",
    ]);
    expect(feedUrlsFromOpml("junk")).toEqual([]);
  });
});

describe("RSS plugin data", () => {
  test("accepts only http(s) feed URLs", () => {
    expect(isHttpFeedUrl("https://example.com/feed.xml")).toBe(true);
    expect(isHttpFeedUrl("http://localhost:8080/rss")).toBe(true);
    expect(isHttpFeedUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpFeedUrl("not a URL")).toBe(false);
  });

  test("reads old persisted subscriptions while dropping malformed entries", () => {
    const storage = {
      get: () => [
        {
          url: "https://example.com/feed.xml",
          title: "Example",
          bookId: "book-1",
          addedAt: "2026-07-20T00:00:00.000Z",
          lastFetched: "2026-07-24T00:00:00.000Z",
          articles: [{ id: "article-0", title: "First" }],
        },
        { title: "Broken" },
      ],
    } as unknown as PluginContext["storage"];

    expect(loadFeeds({ storage })).toEqual([
      {
        url: "https://example.com/feed.xml",
        title: "Example",
        bookId: "book-1",
        addedAt: "2026-07-20T00:00:00.000Z",
        lastFetched: "2026-07-24T00:00:00.000Z",
        articles: [
          {
            id: "article-0",
            title: "First",
            link: undefined,
            publishedAt: undefined,
            publishedAtIso: undefined,
          },
        ],
      },
    ]);
  });

  test("bounds article counts returned to the agent", () => {
    expect(feedToolLimit(undefined)).toBe(10);
    expect(feedToolLimit(4.9)).toBe(4);
    expect(feedToolLimit(100)).toBe(30);
  });
});
