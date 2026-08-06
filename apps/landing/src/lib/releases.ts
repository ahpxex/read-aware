// Download links for the latest stable GitHub release, built without depending
// on any network call — or on knowing the version. Every stable release
// uploads each installer twice: under its versioned name
// (`ReadAware-vX.Y.Z-<platform>-<arch>.<ext>`) and under a version-less stable
// alias (`ReadAware-<platform>-<arch>.<ext>`); see .github/workflows/release.yml,
// "Collect release assets" — keep the alias names below in sync with it. The
// links use `releases/latest/download/<alias>`, which GitHub resolves to the
// newest NON-prerelease release: pre-releases never surface here, and a
// deployed landing can never advertise a version that was not actually
// released. (Baking the version from tauri.conf.json did exactly that once —
// 0.3.0 was bumped on main without being tagged, and every download button
// 404ed.)
//
// The GitHub API is only used to decorate copy with the current version number
// when it happens to respond. It is unauthenticated and rate-limited per
// client IP (60/h — routinely exhausted behind shared proxy egress), so
// nothing the download buttons depend on may touch it: it broke the buttons
// once already. Fetching `releases/latest/download/latest.json` from script is
// not an option either — github.com serves that redirect without CORS headers,
// so browsers refuse it (plain <a href> navigation is exempt, which is why the
// alias hrefs work at all).

const REPO = "ahpxex/read-aware";

export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

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
 * Latest stable version according to the GitHub API, or null when the API is
 * unavailable (rate limit, offline). Display copy only — never link building.
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

const link = (label: string, alias: string): DownloadLink => ({
  label,
  url: `${REPO_URL}/releases/latest/download/ReadAware-${alias}`,
});

/** Per-platform downloads through the version-less stable-alias assets. */
export const DOWNLOADS: PlatformDownload[] = [
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
    extras: [
      link(".msi", "windows-x64.msi"),
      // v0.2.10 predates the portable bundle, so this alias 404s until the
      // next stable release ships; every release from then on carries it.
      link("Portable .zip", "windows-x64-portable.zip"),
    ],
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
