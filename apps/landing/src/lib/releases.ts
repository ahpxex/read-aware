// Live download links, resolved from the project's latest GitHub release. Asset
// names are version-stamped (e.g. `ReadAware_0.2.3_universal.dmg`), so the URLs
// can't be hard-coded — they're read from the release at runtime and mapped to
// each platform by file extension. If the API is unreachable, callers fall back
// to the releases page (see `RELEASES_URL`), so every button still works.

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

export type ReleaseAsset = { name: string; url: string };
export type LatestRelease = { tag: string; assets: ReleaseAsset[] };

export async function fetchLatestRelease(
  signal?: AbortSignal,
): Promise<LatestRelease | null> {
  try {
    const response = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      tag_name?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    if (!data.tag_name || !Array.isArray(data.assets)) return null;
    const assets: ReleaseAsset[] = data.assets
      .filter((a): a is { name: string; browser_download_url: string } =>
        Boolean(a.name && a.browser_download_url),
      )
      .map((a) => ({ name: a.name, url: a.browser_download_url }));
    return { tag: data.tag_name, assets };
  } catch {
    return null;
  }
}

function pick(assets: ReleaseAsset[], pattern: RegExp): ReleaseAsset | undefined {
  return assets.find((asset) => pattern.test(asset.name));
}

function toLink(
  asset: ReleaseAsset | undefined,
  label: string,
): DownloadLink | null {
  return asset ? { label, url: asset.url } : null;
}

/**
 * Map release assets to per-platform downloads. Signatures (`.sig`), the updater
 * manifests (`.json`), and the macOS `.app.tar.gz` (an updater payload, not a
 * user installer) are filtered out; installers are matched by extension.
 */
export function buildDownloads(assets: ReleaseAsset[]): PlatformDownload[] {
  const installers = assets.filter(
    (asset) =>
      !/\.sig$/i.test(asset.name) &&
      !/\.json$/i.test(asset.name) &&
      !/\.app\.tar\.gz$/i.test(asset.name),
  );

  const dmg = pick(installers, /\.dmg$/i);
  const exe = pick(installers, /-setup\.exe$/i) ?? pick(installers, /\.exe$/i);
  const msi = pick(installers, /\.msi$/i);
  const appImage = pick(installers, /\.AppImage$/i);
  const deb = pick(installers, /\.deb$/i);
  const rpm = pick(installers, /\.rpm$/i);
  const apk = pick(installers, /\.apk$/i);

  return [
    {
      id: "macos",
      name: "macOS",
      primary: toLink(dmg, "Download .dmg"),
      extras: [],
    },
    {
      id: "windows",
      name: "Windows",
      primary: toLink(exe, "Download installer"),
      extras: [toLink(msi, ".msi")].filter((l): l is DownloadLink => l !== null),
    },
    {
      id: "linux",
      name: "Linux",
      primary: toLink(appImage, "Download .AppImage"),
      extras: [toLink(deb, ".deb"), toLink(rpm, ".rpm")].filter(
        (l): l is DownloadLink => l !== null,
      ),
    },
    {
      id: "android",
      name: "Android",
      primary: toLink(apk, "Download .apk"),
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
