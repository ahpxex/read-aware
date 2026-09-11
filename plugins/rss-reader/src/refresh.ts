import { subscribe } from "./feed-library";
import { loadFeeds } from "./storage";
import { tr } from "./strings";
import type { RssPluginContext } from "./types";

export const REFRESH_SCHEDULE = "refresh-feeds";
const REFRESH_CONCURRENCY = 4;

async function refreshFeeds(ctx: RssPluginContext) {
  const queue = await loadFeeds(ctx), total = queue.length;
  let refreshed = 0, failed = 0, firstError: unknown;
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, total) }, async () => {
    for (let feed = queue.shift(); feed; feed = queue.shift()) {
      try { await subscribe(ctx, feed.url); refreshed++; }
      catch (error) {
        if (failed === 0) firstError = error;
        failed++;
        console.warn("RSS background refresh failed", error);
      }
    }
  }));
  return { total, refreshed, failed, firstError };
}

export async function refreshAllFeeds(ctx: RssPluginContext): Promise<string> {
  const result = await refreshFeeds(ctx);
  return result.failed === 0 ? tr(ctx.locale, "refreshedAll", { n: result.refreshed })
    : tr(ctx.locale, "refreshedSome", { ok: result.refreshed, total: result.total });
}

export async function refreshScheduledFeeds(ctx: RssPluginContext): Promise<void> {
  const result = await refreshFeeds(ctx);
  // Finish the batch, but never let partial failure advance the host's last success.
  if (result.failed > 0) throw result.firstError ?? new Error("RSS refresh failed");
}
