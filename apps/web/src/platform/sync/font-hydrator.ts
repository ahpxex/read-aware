import { actorFromEvent, causalActor, mergeEventCauses, stampEventCause, type DomainActor } from "../domain-actor";
/**
 * Font hydration — `hydrateMissingCovers`' twin for imported user fonts.
 *
 * A replayed `userFont.imported` projects the registry row and a manifest-only
 * blob row: this device knows the font exists before a single byte is here.
 * This pass fetches those bytes (one small GET per font) and announces each
 * arrival (`user-fonts-changed`) so the reader re-injects its @font-face and
 * the picker's pending badge clears without a reload. The reverse direction —
 * a pulled `userFont.removed` — is settled in the same pass through the
 * durable removal-cleanup queue.
 *
 * Same retry shape as covers: the importing device pushes events before
 * blobs, so "not on the relay yet" is the norm, retried with bounded backoff.
 */
import { createLogger } from "../logger";
import { emitAppEvent } from "../app-events";
import { invoke } from "../ipc";
import { isTauri } from "../environment";
import type { BlobFetcher } from "./cover-hydrator";

/** What `user_font_blob_backlog` returns (camelCase serde). */
type FontBlobBacklogEntry = { fontId: string; blobKey: string };

/** Pulled removals owed a byte release — native re-validates the row is gone. */
async function releasePendingUserFontFiles(): Promise<void> {
  const ids = await invoke<string[]>("user_fonts_removal_backlog");
  if (ids.length === 0) return;
  await invoke("user_fonts_release_files", { ids });
}

const log = createLogger("font-hydrator");

/** First retry after a miss; doubles per miss up to the ceiling. */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

const misses = new Map<string, { count: number; nextAt: number; origin: DomainActor }>();
let lastFetcher: BlobFetcher | null = null;
let running = false;
let generation = 0;
let lastOrigin: DomainActor | undefined;
let queued: { fetchBlob: BlobFetcher; origin: DomainActor } | undefined;
const join = (first: DomainActor, second: DomainActor): DomainActor =>
  actorFromEvent(mergeEventCauses([stampEventCause({}, first), stampEventCause({}, second)], {}));
let retryTimer: number | null = null;

function scheduleRetry(at: number): void {
  const delay = Math.max(1_000, at - Date.now());
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (lastFetcher) void hydrateMissingFonts(lastFetcher, { origin: lastOrigin });
  }, delay);
}

function noteMiss(fontId: string, origin: DomainActor): number {
  const prior = misses.get(fontId)?.count ?? 0;
  const count = prior + 1;
  const nextAt = Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** prior);
  misses.set(fontId, { count, nextAt, origin });
  return nextAt;
}

/**
 * Fetch every imported font whose bytes have not landed. Returns how many
 * landed. `reset` forgets the miss backoff (call it when a pull merged new
 * events). Concurrent calls coalesce into one pass plus one re-run.
 */
export async function hydrateMissingFonts(
  fetchBlob: BlobFetcher,
  options: { reset?: boolean; origin?: DomainActor } = {},
): Promise<number> {
  if (!isTauri()) return 0;
  const origin = causalActor(options.origin ?? "system"),
    epoch = generation;
  lastFetcher = fetchBlob;
  lastOrigin = origin;
  if (options.reset) misses.clear();
  if (running) {
    queued = { fetchBlob, origin: queued ? join(queued.origin, origin) : origin };
    return 0;
  }
  running = true;
  let fetched = 0;
  let earliestRetry = Number.POSITIVE_INFINITY;
  try {
    // Pulled removals first: releasing queued bytes is cheap and frees space
    // before any download; native re-validates the row is really gone.
    await releasePendingUserFontFiles();

    const backlog = await invoke<FontBlobBacklogEntry[]>("user_font_blob_backlog");
    if (epoch !== generation) return fetched;
    for (const entry of backlog) {
      const pending = misses.get(entry.fontId);
      if (pending && pending.nextAt > Date.now()) {
        earliestRetry = Math.min(earliestRetry, pending.nextAt);
        continue;
      }
      const source = pending ? join(pending.origin, origin) : origin;
      const result = await fetchBlob(entry.blobKey, source);
      if (epoch !== generation) return fetched;
      switch (result.outcome) {
        case "fetched":
          misses.delete(entry.fontId);
          fetched += 1;
          emitAppEvent("user-fonts-changed", { fontId: entry.fontId }, source);
          break;
        case "missing":
          // Not uploaded by the peer yet — the expected race; try again later.
          earliestRetry = Math.min(earliestRetry, noteMiss(entry.fontId, source));
          break;
        case "unavailable":
          // No credentials / sync off: nothing in this pass can succeed.
          return fetched;
        case "failed":
          if (result.reason === "unauthenticated") return fetched;
          log.warn(`font fetch for ${entry.fontId} failed (${result.reason}); will retry`);
          earliestRetry = Math.min(earliestRetry, noteMiss(entry.fontId, source));
          break;
      }
    }
    if (Number.isFinite(earliestRetry)) scheduleRetry(earliestRetry);
    return fetched;
  } catch (error) {
    log.warn("font hydration pass failed", error);
    return fetched;
  } finally {
    running = false;
    const next = queued;
    queued = undefined;
    if (next) void hydrateMissingFonts(next.fetchBlob, { origin: next.origin });
  }
}

/**
 * Local delete fast path: the removal event just committed on THIS device —
 * the byte release needs no sync cycle. (Remote devices reach the same state
 * through the pull → hydrator → `releasePendingUserFontFiles` path.)
 */
export async function releaseRemovedUserFontFiles(ids: string[]): Promise<void> {
  if (!isTauri() || ids.length === 0) return;
  try {
    await invoke("user_fonts_release_files", { ids });
  } catch (error) {
    log.warn("removed font bytes release deferred to the cleanup backlog", error);
  }
}

/** Drop pending retries (scheduler shutdown / account change). */
export function stopFontHydration(): void {
  generation++;
  queued = undefined;
  lastOrigin = undefined;
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  misses.clear();
  lastFetcher = null;
}
