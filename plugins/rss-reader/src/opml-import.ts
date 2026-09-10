import { feedUrlsFromOpml } from "./opml";
import { subscribeIfMissing } from "./feed-library";
import type { RssPluginContext } from "./types";

export type OpmlImportItem = { url: string } & (
  { status: "added" | "existing"; bookId: string; title: string; contentPending: boolean }
  | { status: "failed"; errorCode: string }
);
export type OpmlImportResult = {
  total: number; offset: number; nextOffset: number | null;
  added: number; existing: number; failed: number; items: OpmlImportItem[];
};

export async function importOpml(ctx: RssPluginContext, text: string, offset = 0, limit = 10): Promise<OpmlImportResult> {
  const urls = feedUrlsFromOpml(text);
  if (!urls.length || !Number.isSafeInteger(offset) || offset < 0 || offset >= urls.length
    || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw Object.assign(new Error("Invalid OPML or import page"), { code: "plugin/invalid-input" });
  }
  const batch = urls.slice(offset, offset + limit);
  const items = new Array<OpmlImportItem>(batch.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
    while (next < batch.length) {
      const index = next++, url = batch[index]!;
      try {
        const { created, feed } = await subscribeIfMissing(ctx, url);
        items[index] = { url, status: created ? "added" : "existing", title: feed.title, bookId: feed.bookId, contentPending: feed.contentPending === true };
      } catch (error) {
        console.warn("RSS OPML entry import failed", error);
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        items[index] = { url, status: "failed", errorCode: typeof code === "string" && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(code) ? code : "ipc/unknown" };
      }
    }
  }));
  return { total: urls.length, offset, nextOffset: offset + batch.length < urls.length ? offset + batch.length : null,
    added: items.filter(item => item.status === "added").length,
    existing: items.filter(item => item.status === "existing").length,
    failed: items.filter(item => item.status === "failed").length, items };
}
