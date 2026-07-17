// Download links for the latest GitHub release. The release workflow uploads
// every installer twice: version-stamped (`ReadAware-v0.2.9-macos-arm64.dmg`)
// and under a stable alias (`ReadAware-macos-arm64.dmg`), so the alias URLs via
// `releases/latest/download/` can be hard-coded and always resolve — no API
// call needed (see `stableDownloads`). The GitHub API is only a progressive
// enhancement: when it responds it supplies the release tag and swaps in the
// version-stamped assets. It is unauthenticated and rate-limited per client IP
// (60/h — routinely exhausted behind shared proxy egress), so it must never be
// the thing download buttons depend on.

const REPO = "ahpxex/read-aware";

export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
const LATEST_DOWNLOAD_URL = `${REPO_URL}/releases/latest/download`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * Stable, version-less asset aliases the release workflow attaches to every
 * release (see `.github/workflows/release.yml`, "Collect release assets").
 * Must stay in sync with that naming scheme.
 */
const STABLE_ASSET_NAMES = [
  "ReadAware-macos-arm64.dmg",
  "ReadAware-macos-x64.dmg",
  "ReadAware-windows-x64-setup.exe",
  "ReadAware-windows-x64.msi",
  "ReadAware-linux-x64.AppImage",
  "ReadAware-linux-x64.deb",
  "ReadAware-linux-x64.rpm",
  "ReadAware-android-arm64.apk",
];

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
      // Drop the stable aliases: they duplicate the version-stamped assets,
      // sort ahead of them, and would otherwise win every `pick`.
      .filter((a) => !STABLE_ASSET_NAMES.includes(a.name))
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
 *
 * macOS ships per chip since v0.2.8 (`-macos-arm64` / `-macos-x64`); Apple
 * Silicon leads and the Intel build is the alternative. A release predating
 * the split (a single universal `.dmg`) still resolves through the plain
 * extension match.
 */
export function buildDownloads(assets: ReleaseAsset[]): PlatformDownload[] {
  const installers = assets.filter(
    (asset) =>
      !/\.sig$/i.test(asset.name) &&
      !/\.json$/i.test(asset.name) &&
      !/\.app\.tar\.gz$/i.test(asset.name),
  );

  const dmgAppleSilicon = pick(installers, /macos-arm64\.dmg$/i);
  const dmgIntel = pick(installers, /macos-x64\.dmg$/i);
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
      primary:
        toLink(dmgAppleSilicon, "Download .dmg (Apple Silicon)") ??
        toLink(dmg, "Download .dmg"),
      extras: [toLink(dmgIntel, "Intel .dmg")].filter(
        (l): l is DownloadLink => l !== null,
      ),
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

/**
 * Downloads built from the stable alias URLs — always valid, no network round
 * trip. This is the default set; the API-resolved set only refines it.
 */
export function stableDownloads(): PlatformDownload[] {
  return buildDownloads(
    STABLE_ASSET_NAMES.map((name) => ({
      name,
      url: `${LATEST_DOWNLOAD_URL}/${name}`,
    })),
  );
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
