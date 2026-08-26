/**
 * Code-level rate limiting over the D1-shaped database — the source of truth
 * for exact business limits (docs/sync-engine.md §4 revisited). Cloudflare WAF
 * rules should reject bursts before the Worker; these longer email/account
 * windows remain in code because they depend on identities the edge cannot
 * reliably derive, deploy with the application, and run under the test suite.
 *
 * Fixed windows: `window_start_ms` is `floor(now / windowMs) * windowMs`.
 * Deliberately not sliding/tokens — the guarded endpoints (magic-link mail,
 * anonymous checkout, OAuth state minting) tolerate edge bursts, and the
 * counter is a single atomic upsert instead of a read-modify-write.
 */
import type { D1Like } from "./account-store";

export interface RateLimitStore {
  /**
   * Count one hit in the window; returns the count AFTER this hit. The
   * upsert-increment is atomic, so concurrent requests can neither double-
   * decrement a limit nor lose a hit.
   */
  hit(bucket: string, subjectHash: string, windowStartMs: number): Promise<number>;
  /** Drop windows that ended before `beforeMs` (hourly Cron housekeeping). */
  cleanup(beforeMs: number): Promise<void>;
}

export class SqlRateLimitStore implements RateLimitStore {
  constructor(private db: D1Like) {}

  async hit(bucket: string, subjectHash: string, windowStartMs: number): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO rate_windows (bucket, subject_hash, window_start_ms, count)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT (bucket, subject_hash, window_start_ms)
           DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(bucket, subjectHash, windowStartMs)
      .first<{ count: number }>();
    return Number(row?.count ?? 1);
  }

  async cleanup(beforeMs: number): Promise<void> {
    await this.db
      .prepare(`DELETE FROM rate_windows WHERE window_start_ms < ?1`)
      .bind(beforeMs)
      .run();
  }
}

/** The window an instant falls into, as its inclusive start millisecond. */
export const windowStartMs = (nowMs: number, windowMs: number): number =>
  Math.floor(nowMs / windowMs) * windowMs;

/**
 * Fold a client address into the unit that per-IP throttling counts:
 * IPv4 (plain or v4-mapped) passes through; IPv6 collapses to its /64 —
 * otherwise a rotating v6 host mints an unbounded supply of "distinct"
 * addresses and every per-IP counter is fiction. Malformed input passes
 * through and gets hashed as-is (the hash still separates subjects).
 */
export function foldClientIp(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const groups: number[] = [];
  const parseGroup = (group: string): number[] => {
    if (group.includes(".")) {
      // An embedded IPv4 tail occupies two groups.
      const [a, b, c, d] = group.split(".").map(Number);
      return [((a << 8) | b) >>> 0, ((c << 8) | d) >>> 0];
    }
    const value = parseInt(group, 16);
    return [Number.isFinite(value) ? value : 0];
  };
  for (const group of head.split(":").filter(Boolean)) groups.push(...parseGroup(group));
  const fill = 8 - groups.length - (tail ? tail.split(":").filter(Boolean).length : 0);
  for (let i = 0; i < Math.max(0, fill); i += 1) groups.push(0);
  for (const group of tail.split(":").filter(Boolean)) groups.push(...parseGroup(group));
  while (groups.length < 8) groups.push(0);
  return `${groups.slice(0, 4).map((g) => g.toString(16).padStart(4, "0")).join(":")}:/64`;
}
