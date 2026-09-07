import {
  analyticsAllowed,
  canonicalPath,
  DOWNLOAD_ASSETS,
  EVENT_PATH,
  type SiteEvent,
} from "./site-events";
import { resolveAttribution } from "./site-attribution";
import { CURRENT_RELEASE_TAG } from "./releases";

const STORAGE_KEY = "readaware-site-attribution-v1";

// No identifier: only a coarse source and a public route survive navigation.
export function startSiteAnalytics(paths: readonly string[]): void {
  const allowed = () =>
    analyticsAllowed(
      new URL(location.href),
      navigator.doNotTrack,
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true,
    );
  if (!allowed()) return;
  const pages = new Set(paths.map(canonicalPath));
  const landing = canonicalPath(location.pathname);
  if (!pages.has(landing)) return;
  // Keep the existing aggregate performance dashboard, only on public production
  // pages. Auth trampolines never boot this entry, and opt-out applies to both.
  const beacon = document.createElement("script");
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.defer = true;
  beacon.dataset.cfBeacon = JSON.stringify({
    token: "8d4f77280032445189b3fcee84ec344c",
  });
  document.head.append(beacon);
  let saved: unknown = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    // Storage may be disabled; attribution still works for this document.
  }
  const url = new URL(location.href);
  const { attribution: current, fresh } = resolveAttribution(
    saved,
    url,
    document.referrer,
    pages,
    Date.now(),
  );
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Best effort session metadata, never required to download or navigate.
  }

  const send = (event: SiteEvent) => {
    if (!allowed()) return;
    const body = new Blob([JSON.stringify(event)], {
      type: "application/json",
    });
    try {
      if (navigator.sendBeacon?.(EVENT_PATH, body)) return;
    } catch {
      // A blocked beacon may still permit a first-party keepalive request.
    }
    void fetch(EVENT_PATH, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).catch(() => {
      /* Optional aggregate metrics must never affect downloads. */
    });
  };
  if (fresh)
    send({
      version: 1,
      event: "landing",
      source: current.source,
      landing,
      page: landing,
      asset: "",
      release: CURRENT_RELEASE_TAG,
    });
  const onClick = (event: MouseEvent) => {
    if (
      !event.isTrusted ||
      event.button > 1 ||
      (event.type === "click" && event.button !== 0)
    )
      return;
    const anchor = event
      .composedPath()
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
    const asset = DOWNLOAD_ASSETS.find((asset) => asset.url === anchor?.href);
    const page = canonicalPath(location.pathname);
    if (!asset || !pages.has(page)) return;
    const active =
      Date.now() < current.expires
        ? current
        : { source: "direct" as const, landing: page };
    send({
      version: 1,
      event: "download",
      source: active.source,
      landing: active.landing,
      page,
      asset: asset.asset,
      release: CURRENT_RELEASE_TAG,
    });
  };
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("auxclick", onClick, { capture: true });
}
