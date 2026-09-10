import type { PluginBookContent, PluginMigrationStorage } from "@read-aware/plugin-types";
import type { FeedSubscription } from "./types";
import { digest } from "./identity";

type Context = { services: { storage: PluginMigrationStorage } };
const collection = "feed-content";
const unavailable = () => Object.assign(new Error("Cached feed content is missing or invalid"), { code: "library/content-unavailable" });

export async function storeContent(ctx: Context, url: string, content: PluginBookContent, bookId: string): Promise<string> {
  const value = { version: 1, url, content };
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > 4 * 1024 * 1024) {
    throw Object.assign(new Error("Cached feed exceeds 4 MiB"), { code: "plugin/payload-too-large" });
  }
  const id = await digest(json);
  await ctx.services.storage.collection(collection).put(id, value, { bookId });
  return id;
}

export async function cachedContent(ctx: Context, feed: FeedSubscription): Promise<PluginBookContent | null> {
  if (!feed.contentId) return null;
  const row = await ctx.services.storage.collection(collection).get<{ version: number; url: string; content: PluginBookContent }>(feed.contentId);
  const value = row?.data;
  if (!value || value.version !== 1 || value.url !== feed.url || !value.content || !Array.isArray(value.content.sections)
    || value.content.sections.length !== feed.articles.length
    || value.content.sections.some((section, index) => !section || typeof section.html !== "string" || section.id !== feed.articles[index]?.id)
    || await digest(JSON.stringify(value)) !== feed.contentId) throw unavailable();
  return structuredClone(value.content);
}

export async function discardContent(ctx: Context, id: string): Promise<void> {
  await ctx.services.storage.collection(collection).delete(id);
}

export async function discardUnreferencedContent(ctx: Context, id: string): Promise<void> {
  try { await discardContent(ctx, id); }
  catch (error) { console.warn("RSS unreferenced content cleanup failed", error); }
}
