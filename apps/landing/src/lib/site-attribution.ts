import { canonicalPath, sourceFrom, SOURCES, type Source } from "./site-events";

export const SESSION_MS = 30 * 60 * 1000;
export type Attribution = { source: Source; landing: string; expires: number };

export function resolveAttribution(
  saved: unknown,
  url: URL,
  referrer: string,
  pages: ReadonlySet<string>,
  now: number,
) {
  const old = saved as Partial<Attribution> | null;
  const valid =
    old &&
    SOURCES.includes(old.source as Source) &&
    typeof old.landing === "string" &&
    pages.has(old.landing) &&
    typeof old.expires === "number" &&
    old.expires > now &&
    old.expires <= now + SESSION_MS;
  let external = false;
  try {
    external = Boolean(referrer && new URL(referrer).origin !== url.origin);
  } catch {
    /* Invalid referrer is treated as unknown. */
  }
  const source = sourceFrom(url, referrer);
  // A browser-language redirect preserves UTM parameters. Do not count it as
  // another entry or replace the original landing path with its translation.
  const fresh =
    !valid ||
    external ||
    (url.searchParams.has("utm_source") && source !== old.source);
  const attribution: Attribution = fresh
    ? {
        source,
        landing: canonicalPath(url.pathname),
        expires: now + SESSION_MS,
      }
    : {
        source: old.source as Source,
        landing: old.landing!,
        expires: old.expires!,
      };
  return { attribution, fresh };
}
