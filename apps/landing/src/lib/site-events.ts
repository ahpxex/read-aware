import { DOWNLOADS } from "./releases";

export const SITE_ORIGIN = "https://readaware.app";
export const EVENT_PATH = "/api/site-events";
export const SOURCES = [
  "direct",
  "google",
  "bing",
  "chatgpt",
  "perplexity",
  "claude",
  "copilot",
  "github",
  "duckduckgo",
  "baidu",
  "other",
] as const;
export type Source = (typeof SOURCES)[number];
export type SiteEvent = {
  version: 1;
  event: "landing" | "download";
  source: Source;
  landing: string;
  page: string;
  asset: string;
  release: string;
};

export const DOWNLOAD_ASSETS = DOWNLOADS.flatMap((platform) =>
  [platform.primary, ...platform.extras].flatMap((link) =>
    link
      ? [
          {
            url: link.url,
            asset: new URL(link.url).pathname.split("/").pop()!,
            platform: platform.id,
          },
        ]
      : [],
  ),
);

const hosts: Record<string, Source> = {
  "google.com": "google",
  "google.co.uk": "google",
  "google.de": "google",
  "google.fr": "google",
  "google.co.jp": "google",
  "google.com.hk": "google",
  "google.com.tw": "google",
  "bing.com": "bing",
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "perplexity.ai": "perplexity",
  "claude.ai": "claude",
  "copilot.microsoft.com": "copilot",
  "github.com": "github",
  "duckduckgo.com": "duckduckgo",
  "baidu.com": "baidu",
};

export function sourceFrom(url: URL, referrer: string): Source {
  const campaign = url.searchParams.get("utm_source")?.toLowerCase();
  if (campaign)
    return (
      hosts[campaign] ??
      (SOURCES.includes(campaign as Source) ? (campaign as Source) : "other")
    );
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === "readaware.app") return "direct";
    return (
      Object.entries(hosts).find(
        ([known]) => host === known || host.endsWith(`.${known}`),
      )?.[1] ?? "other"
    );
  } catch {
    return "other";
  }
}

export function canonicalPath(path: string): string {
  return path === "/" ? "/" : `${path.replace(/\/$/, "")}/`;
}

export function validateEvent(
  value: unknown,
  pages: ReadonlySet<string>,
): value is SiteEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (
    Object.keys(e).sort().join(",") !==
    "asset,event,landing,page,release,source,version"
  )
    return false;
  return (
    e.version === 1 &&
    (e.event === "landing" || e.event === "download") &&
    typeof e.release === "string" &&
    /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(e.release) &&
    SOURCES.includes(e.source as Source) &&
    typeof e.landing === "string" &&
    pages.has(e.landing) &&
    typeof e.page === "string" &&
    pages.has(e.page) &&
    (e.event === "landing"
      ? e.asset === "" && e.landing === e.page
      : DOWNLOAD_ASSETS.some((a) => a.asset === e.asset))
  );
}

export function analyticsAllowed(
  url: URL,
  dnt: string | null,
  gpc: boolean,
): boolean {
  return (
    url.origin === SITE_ORIGIN &&
    dnt !== "1" &&
    !gpc &&
    !url.pathname.startsWith("/sync/") &&
    ![...url.searchParams.keys()].some((key) =>
      /token|ticket|code|email|session|key/i.test(key),
    ) &&
    !/[=&]/.test(url.hash)
  );
}
