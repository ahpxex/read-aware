// Download links for the latest GitHub release, built without depending on any
// network call. Every release ships one deterministic set of asset names —
// `ReadAware-vX.Y.Z-<platform>-<arch>.<ext>` (see .github/workflows/release.yml,
// "Collect release assets") — so knowing the version is knowing every URL.
//
// The version is baked in at build time from the desktop app's own config
// (`__READAWARE_VERSION__`, see vite.config.ts): the landing lives in the same
// monorepo, and every release bumps that config in the same commit as the tag.
// A landing build that lags the newest tag still serves working links — old
// tags keep their assets forever, and the installed app self-updates.
//
// The GitHub API refines this at runtime when it happens to respond (it may
// know a newer release than the deployed landing). It is unauthenticated and
// rate-limited per client IP (60/h — routinely exhausted behind shared proxy
// egress), so it must never be the thing download buttons depend on: it broke
// the buttons once already. Fetching `releases/latest/download/latest.json`
// directly is not an option either — github.com serves that redirect without
// CORS headers, so browsers refuse it (plain <a href> navigation is exempt,
// which is why version-stamped hrefs work at all).

const REPO = "ahpxex/read-aware";

export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** App version this build advertises (e.g. "0.2.10"), baked at build time. */
export const BAKED_VERSION: string = __READAWARE_VERSION__;

export type PlatformId = "macos" | "windows" | "linux" | "android" | "ios";

export type DownloadLink = { label: string; url: string };

export type PlatformDownload = {
  id: PlatformId;
  name: string;
  /** Recommended installer for the platform, or null when unavailable. */
  primary: DownloadLink | null;
  /** Alternative packages (e.g. `.msi`, `.deb`, `.rpm`). */
  extras: DownloadLink[];
  /** Announced but not yet shipping. */
  comingSoon?: boolean;
};

/**
 * Latest release version according to the GitHub API, or null when the API is
 * unavailable (rate limit, offline). Purely a refinement over BAKED_VERSION.
 */
export async function fetchLatestVersion(
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: unknown };
    if (typeof data.tag_name !== "string") return null;
    const version = data.tag_name.replace(/^v/, "");
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * Per-platform downloads with version-stamped URLs, derived from the release
 * naming scheme. Must stay in sync with the workflow's "Collect release
 * assets" step.
 */
export function buildDownloads(version: string): PlatformDownload[] {
  const link = (label: string, suffix: string): DownloadLink => ({
    label,
    url: `${REPO_URL}/releases/download/v${version}/ReadAware-v${version}-${suffix}`,
  });

  const windowsExtras = [link(".msi", "windows-x64.msi")];
  // v0.2.10 predates the portable bundle — drop this guard once any newer
  // release has shipped.
  if (version !== "0.2.10") {
    windowsExtras.push(link("Portable .zip", "windows-x64-portable.zip"));
  }

  return [
    {
      id: "macos",
      name: "macOS",
      primary: link("Download .dmg (Apple Silicon)", "macos-arm64.dmg"),
      extras: [link("Intel .dmg", "macos-x64.dmg")],
    },
    {
      id: "windows",
      name: "Windows",
      primary: link("Download installer", "windows-x64-setup.exe"),
      extras: windowsExtras,
    },
    {
      id: "linux",
      name: "Linux",
      primary: link("Download .AppImage", "linux-x64.AppImage"),
      extras: [link(".deb", "linux-x64.deb"), link(".rpm", "linux-x64.rpm")],
    },
    {
      id: "android",
      name: "Android",
      primary: link("Download .apk", "android-arm64.apk"),
      extras: [],
    },
    { id: "ios", name: "iOS", primary: null, extras: [], comingSoon: true },
  ];
}

/** Best-effort OS guess from the user agent, to feature the right download. */
export function detectPlatform(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): PlatformId | null {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/mac/i.test(userAgent)) return "macos";
  if (/win/i.test(userAgent)) return "windows";
  if (/linux/i.test(userAgent)) return "linux";
  return null;
}
