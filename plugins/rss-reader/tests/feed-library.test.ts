import { expect, test } from "bun:test";
import type { PluginBookContent, PluginToolDefinition } from "@read-aware/plugin-types";
import plugin from "../src/index";
import { parseFeed } from "../src/feed";
import { forgetRemovedBook, loadFeedContent, openFeed, subscribe, unsubscribeFeed } from "../src/feed-library";
import { getFeed } from "../src/storage";
import type { RssPluginContext } from "../src/types";
import { importOpml } from "../src/opml-import";
import { importOpmlView } from "../src/views";

const url = "https://example.com/feed";
const xml = (items: string) => `<rss><channel><title>Feed</title>${items}</channel></rss>`;
const item = (id: string, body = id) => `<item><guid>${id}</guid><title>${id}</title><description>${body}</description></item>`;

function fixture() {
  const tools: PluginToolDefinition[] = [];
  const tables = new Map<string, Map<string, unknown>>();
  const table = (name: string) => { let values = tables.get(name); if (!values) { values = new Map(); tables.set(name, values); } return values; };
  const state = { xml: xml(item("one")), fetches: 0, notifications: 0, offline: false, failIndex: false, failNotify: false, failedUrls: new Set<string>(),
    bookId: "book-1", failRemove: false, sourceRevision: "new", readingRevision: "old", readingBook: "book-1", events: [] as string[], hold: undefined as Promise<void> | undefined };
  let provider: ((key: string) => Promise<PluginBookContent>) | undefined;
  const ctx = {
    locale: "en",
    services: {
      storage: { get: () => null, collection: (name: string) => ({
        put: async (id: string, data: unknown) => {
          if (name === "feeds" && state.failIndex) throw Object.assign(Error("Index write failed"), { code: "db/locked" });
          table(name).set(id, structuredClone(data));
        },
        get: async (id: string) => table(name).has(id) ? { id, data: structuredClone(table(name).get(id)), updatedAt: "" } : null,
        delete: async (id: string) => { table(name).delete(id); },
        list: async () => [...table(name)].map(([id, data]) => ({ id, data: structuredClone(data), updatedAt: "" })),
      }) },
      network: { fetch: async (url: string) => { state.fetches++; if (state.hold) await state.hold; if (state.offline || state.failedUrls.has(url)) throw Object.assign(Error("Offline"), { code: "plugin/network-timeout" }); return new Response(state.xml); } },
      ui: { showToast: () => {} }, schedules: { bind: () => ({ dispose() {} }) },
    },
    domains: {
      library: {
        commands: { books: {
          addVirtualBook: async () => ({ id: state.bookId }),
          removeVirtualBook: async () => { if (state.failRemove) throw Object.assign(new Error("Removal failed"), { code: "db/locked" }); },
          invalidateVirtualBook: async ({ key }: { key: string }) => {
            state.notifications++;
            const feed = await getFeed(ctx, key);
            expect(feed?.contentId).toBeDefined(); expect(table("feed-content").has(feed!.contentId!)).toBe(true);
            if (state.failNotify) throw Object.assign(Error("Notification failed"), { code: "plugin/unavailable" });
            return { bookId: state.bookId, revision: "invalidated" };
          },
        } },
        queries: { books: { getContentState: async () => ({ sourceRevision: state.sourceRevision }) } },
        events: { subscribe: () => ({ dispose() {} }) },
      },
      reading: {
        queries: { session: async () => ({ bookId: state.readingBook, status: "ready", sessionId: "session", sourceRevision: state.readingRevision,
          location: { bookId: state.readingBook, contentVersion: "current-version" } }) },
        commands: {
          reload: async (guard: unknown) => { expect(guard).toEqual({ bookId: state.bookId, sessionId: "session" }); state.events.push("reload"); state.readingRevision = state.sourceRevision; },
          openBook: async (bookId: string) => { state.events.push("open"); state.readingBook = bookId; },
          goTo: async (target: { bookId: string; href: string; contentVersion: string }) => { expect(target.contentVersion).toBe("current-version"); state.events.push(`go:${target.href}`); },
        },
      },
    },
    contributions: {
      contentProviders: { register: (value: { load: typeof provider }) => { provider = value.load; return { dispose() {} }; } },
      headerActions: { register: () => ({ dispose() {} }) }, commands: { register: () => ({ dispose() {} }) }, agentTools: { register: (tool: PluginToolDefinition) => { tools.push(tool); return { dispose() {} }; } },
    },
  } as unknown as RssPluginContext;
  return { ctx, state, table, tools, provider: () => provider! };
}

const opml = (urls: string[]) => `<opml><body>${urls.map(url => `<outline xmlUrl="${url}"/>`).join("")}</body></opml>`;

test("OPML pages distinguish existing, added and failed entries and never refresh existing feeds", async () => {
  const f = fixture(); await plugin.activate(f.ctx); await subscribe(f.ctx, url);
  const urls = [url, ...Array.from({ length: 11 }, (_, index) => `${url}/${index}`)];
  f.state.failedUrls.add(urls[1]!);
  const input = opml(urls);
  const importer = f.tools.find(tool => tool.name === "import_opml")!;
  expect(importer.approval).toBe("required"); expect(importer.contexts).toEqual(["global"]);
  const page = await importer.execute({ opml: input });
  expect(page).toMatchObject({ total: 12, offset: 0, nextOffset: 10, added: 8, existing: 1, failed: 1 });
  expect((page as Awaited<ReturnType<typeof importOpml>>).items.map(item => item.url)).toEqual(urls.slice(0, 10));
  expect(f.state.fetches).toBe(10);
  expect(await importOpml(f.ctx, input, 10)).toMatchObject({ nextOffset: null, added: 2, failed: 0 });
  const failed = (page as Awaited<ReturnType<typeof importOpml>>).items[1]!;
  expect(failed).toEqual({ url: urls[1]!, status: "failed", errorCode: "plugin/network-timeout" });
  const before = f.state.fetches;
  await expect(importOpml(f.ctx, input, -1)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(importOpml(f.ctx, input, 0, 21)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(importOpml(f.ctx, "<opml/>")).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.state.fetches).toBe(before);
});

test("concurrent OPML imports create each subscription once and UI returns a paged outcome", async () => {
  const f = fixture(), input = opml([url]);
  const results = await Promise.all([importOpml(f.ctx, input), importOpml(f.ctx, input)]);
  expect(results.map(result => result.added).sort()).toEqual([0, 1]); expect(f.state.fetches).toBe(1);
  const form = importOpmlView(f.ctx, input);
  expect(form.fields[0]).toMatchObject({ value: input });
  expect(await form.onSubmit({ opml: "" })).toHaveProperty("fieldErrors.opml");
  const result = await form.onSubmit({ opml: input });
  expect(result).toMatchObject({ navigation: "replace", view: { kind: "detail", title: "Import OPML" } });
  expect(JSON.stringify(result)).toContain("already subscribed");
});

test("RSS unsubscribe tool requires approval, refuses changed bindings and preserves failed removals", async () => {
  const f = fixture(); await plugin.activate(f.ctx); const feed = await subscribe(f.ctx, url);
  const tool = f.tools.find(tool => tool.name === "unsubscribe_feed")!;
  expect(tool.approval).toBe("required"); expect(tool.contexts).toEqual(["global"]);
  await expect(tool.execute({ url, bookId: "old-book" })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(await getFeed(f.ctx, url)).not.toBeNull();
  f.state.failRemove = true;
  await expect(tool.execute({ url, bookId: feed.bookId })).rejects.toMatchObject({ code: "db/locked" });
  expect(await getFeed(f.ctx, url)).not.toBeNull();
  f.state.failRemove = false;
  expect(await tool.execute({ url, bookId: feed.bookId })).toEqual({ unsubscribed: true, url, bookId: feed.bookId });
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
});

test("RSS IDs follow declared identities or links across insertion, reordering and edits", async () => {
  const before = await parseFeed(xml(item("one") + item("two")), url);
  const after = await parseFeed(xml(item("new") + item("two", "edited") + item("one") + item("one")), url);
  expect(after.articles).toHaveLength(3);
  expect(after.articles[1]!.id).toBe(before.articles[1]!.id);
  expect(after.articles[2]!.id).toBe(before.articles[0]!.id);
  expect(after.content.sections[1]!.html).toContain("edited");
  expect(before.articles[0]!.link).toBeUndefined();
  expect(before.content.sections[0]!.html).not.toContain("Read on the web");
  const atom = await parseFeed('<feed><entry><id>tag:stable</id><title>Before</title></entry></feed>', url);
  const atomEdit = await parseFeed('<feed><entry><id>tag:stable</id><title>After</title></entry></feed>', url);
  expect(atom.articles[0]!.id).toBe(atomEdit.articles[0]!.id);
  const linked = await parseFeed(xml('<item><link>/a</link><title>A</title></item>'), url);
  const linkedEdit = await parseFeed(xml('<item><link>/a</link><title>B</title></item>'), url);
  expect(linked.articles[0]!.id).toBe(linkedEdit.articles[0]!.id);
  const anonymous = await parseFeed(xml('<item><description>A</description></item><item><description>B</description></item>'), url);
  expect(anonymous.articles[0]!.id).not.toBe(anonymous.articles[1]!.id);
});

test("activated provider opens saved full content offline, and unchanged refresh does not invalidate", async () => {
  const f = fixture(); await plugin.activate(f.ctx);
  const feed = await subscribe(f.ctx, url);
  expect(feed.contentId).toMatch(/^[a-f0-9]{64}$/); expect(feed.contentPending).toBeUndefined();
  expect(f.state.notifications).toBe(1);
  await subscribe(f.ctx, url); expect(f.state.notifications).toBe(1);
  f.state.offline = true;
  const content = await f.provider()(url); content.sections[0]!.html = "mutated";
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  expect(f.state.fetches).toBe(2); expect(f.table("feed-content").size).toBe(1);
  expect(JSON.stringify(f.table("feeds").get(url))).not.toContain('"html"');
});

test("failed network/index writes preserve the old readable snapshot and pending notification retries", async () => {
  const f = fixture(); const original = await subscribe(f.ctx, url);
  f.state.offline = true;
  await expect(subscribe(f.ctx, url)).rejects.toThrow("Offline");
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  f.state.offline = false; f.state.xml = xml(item("one", "updated")); f.state.failIndex = true;
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "db/locked" });
  expect((await getFeed(f.ctx, url))?.contentId).toBe(original.contentId);
  expect(f.table("feed-content").size).toBe(1);
  f.state.failIndex = false; f.state.failNotify = true;
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect((await getFeed(f.ctx, url))?.contentPending).toBe(true);
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("updated");
  f.state.failNotify = false;
  expect((await subscribe(f.ctx, url)).contentPending).toBeUndefined();
  expect(f.state.notifications).toBe(3); expect(f.table("feed-content").size).toBe(1);
  f.state.xml = "x".repeat(4 * 1024 * 1024 + 1);
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
});

test("legacy source seeds once; a missing or corrupt referenced cache is an error, not a network fallback", async () => {
  const f = fixture();
  f.table("feeds").set(url, { url, title: "Old", bookId: "book-1", articles: [{ id: "article-0", title: "Old" }] });
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  expect(f.state.fetches).toBe(1); expect(f.state.notifications).toBe(0);
  const feed = (await getFeed(f.ctx, url))!;
  f.table("feed-content").set(feed.contentId!, { version: 1, url, content: { sections: [{ id: feed.articles[0]!.id, html: "corrupt" }] } });
  await expect(loadFeedContent(f.ctx, url)).rejects.toMatchObject({ code: "library/content-unavailable" });
  f.table("feed-content").clear();
  await expect(loadFeedContent(f.ctx, url)).rejects.toMatchObject({ code: "library/content-unavailable" });
  expect(f.state.fetches).toBe(1);
});

test("same-feed operations serialize and removed-book cleanup cannot delete a resubscription", async () => {
  const f = fixture(); let release!: () => void;
  f.state.hold = new Promise<void>(resolve => { release = resolve; });
  const first = subscribe(f.ctx, url), second = subscribe(f.ctx, url);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(f.state.fetches).toBe(1);
  release(); await Promise.all([first, second]);
  expect(f.state.fetches).toBe(2); expect(f.table("feed-content").size).toBe(1);
  await unsubscribeFeed(f.ctx, url);
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
  f.state.bookId = "book-2"; await subscribe(f.ctx, url);
  expect(await forgetRemovedBook(f.ctx, "book-1")).toBeNull();
  expect((await getFeed(f.ctx, url))?.bookId).toBe("book-2");
});

test("explicit article open reloads an outdated current source before versioned navigation", async () => {
  const f = fixture(); const feed = await subscribe(f.ctx, url);
  await openFeed(f.ctx, feed, feed.articles[0]!.id);
  expect(f.state.events).toEqual(["reload", "open", `go:${feed.articles[0]!.id}`]);
  f.state.events = [];
  await openFeed(f.ctx, feed); expect(f.state.events).toEqual(["open"]);
  await expect(openFeed(f.ctx, feed, "article-0")).rejects.toMatchObject({ code: "reader/target-not-found" });
  expect(f.state.fetches).toBe(1);
});
