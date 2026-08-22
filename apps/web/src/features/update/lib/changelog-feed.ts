/**
 * The in-dialog changelog. The landing site publishes its hand-written
 * changelog registry as /changelog.json at build time (apps/landing/scripts/
 * prerender.mjs) — the same all-locale data the /changelog pages render
 * from — and this module fetches the entry for the version the app just
 * updated to, so the post-update dialog can show the notes instead of
 * linking out to them.
 *
 * Pre-releases are deliberately absent from that registry (the publishing
 * pipeline curates stable releases only), and so is any version the site
 * hasn't caught up with yet. Both cases — and any network/shape failure —
 * resolve to null, and the dialog falls back to its one-line copy plus the
 * external link. The dialog must never block on this: callers race the
 * fetch against a timeout.
 */

export const CHANGELOG_JSON_URL = (() => {
  // Dev-only override (local landing build under test); mirrors the
  // VITE_READAWARE_RELAY_URL pattern in platform/sync/sync-scheduler.ts.
  const dev = import.meta.env.VITE_READAWARE_CHANGELOG_URL as string | undefined;
  if (dev && import.meta.env.DEV) return dev;
  return "https://readaware.app/changelog.json";
})();

export type ChangelogGroupKind = "new" | "improved" | "fixed";

export type ChangelogGroup = {
  kind: ChangelogGroupKind;
  items: { title?: string; body: string }[];
};

export type ChangelogEntryText = {
  summary: string;
  groups: ChangelogGroup[];
};

/** The resolved, locale-picked slice the dialog renders. */
export type WhatsNewEntry = {
  version: string;
  codename: string | null;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  text: ChangelogEntryText;
};

type RegistryEntry = {
  version: string;
  codename?: string;
  date: string;
  text: Record<string, ChangelogEntryText>;
};

/**
 * The site's locale keys differ from the app's i18n locales in exactly one
 * family: the app distinguishes zh-Hans/zh-Hant where the site uses
 * zh/zh-hant. Everything else maps identity; anything unknown falls back to
 * English rather than to nothing.
 */
export function siteLocaleKey(appLocale: string): string {
  if (appLocale.startsWith("zh-Hans") || appLocale === "zh") return "zh";
  if (appLocale.startsWith("zh-Hant") || appLocale === "zh-hant") return "zh-hant";
  return appLocale;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseGroup(value: unknown): ChangelogGroup | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== "new" && kind !== "improved" && kind !== "fixed") return null;
  if (!Array.isArray(value.items)) return null;
  const items: ChangelogGroup["items"] = [];
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.body !== "string") return null;
    items.push({
      body: item.body,
      ...(typeof item.title === "string" ? { title: item.title } : {}),
    });
  }
  return { kind, items };
}

function parseEntryText(value: unknown): ChangelogEntryText | null {
  if (!isRecord(value)) return null;
  if (typeof value.summary !== "string" || !Array.isArray(value.groups)) return null;
  const groups: ChangelogGroup[] = [];
  for (const group of value.groups) {
    const parsed = parseGroup(group);
    if (!parsed) return null;
    groups.push(parsed);
  }
  return { summary: value.summary, groups };
}

/**
 * Exact-version lookup with locale fallback (requested → en → null).
 * Defensive against a malformed registry: a bad entry is skipped, not thrown.
 */
export function pickChangelogEntry(
  registry: unknown,
  version: string,
  appLocale: string,
): WhatsNewEntry | null {
  if (!Array.isArray(registry)) return null;
  const entry = registry.find(
    (candidate): candidate is RegistryEntry =>
      isRecord(candidate) && candidate.version === version,
  );
  if (!entry || !isRecord(entry.text)) return null;

  const wanted = siteLocaleKey(appLocale);
  const keys = [wanted, "en"].filter(
    (key, index, all) => all.indexOf(key) === index,
  );
  for (const key of keys) {
    const text = parseEntryText(entry.text[key]);
    if (text) {
      return {
        version: entry.version,
        codename: typeof entry.codename === "string" ? entry.codename : null,
        date: typeof entry.date === "string" ? entry.date : "",
        text,
      };
    }
  }
  return null;
}

/** Fetch + pick, racing a timeout so a slow site never stalls the dialog.
 *  `no-store` is correctness, not politeness: this fires exactly once per
 *  version change, right after the app updated — a heuristically-cached
 *  copy from the PREVIOUS update would lack the new version's entry and
 *  wrongly degrade the dialog to its fallback. */
export async function fetchWhatsNewEntry(
  version: string,
  appLocale: string,
  fetchFn: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  timeoutMs: number = 2_500,
): Promise<WhatsNewEntry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(CHANGELOG_JSON_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return pickChangelogEntry(await response.json(), version, appLocale);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
