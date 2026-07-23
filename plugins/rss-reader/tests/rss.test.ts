import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { feedToolLimit } from "../src/agent-tools";
import { isHttpFeedUrl } from "../src/feed";
import { loadFeeds } from "../src/storage";

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
