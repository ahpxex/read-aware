/**
 * Beta-channel release discovery: list the repo's releases through the GitHub
 * API and pick the semver-largest one (pre-releases included) that actually
 * ships the wanted updater manifest. Pure and injectable for tests; the
 * network shape (fetch, JSON) is the only impurity.
 *
 * The resolved URL is only a POINTER — the Rust side allow-lists it to our
 * own release assets, and the updater verifies every manifest and artifact
 * against the minisign pubkey baked into tauri.conf.json.
 */

const RELEASES_API_URL = "https://api.github.com/repos/ahpxex/read-aware/releases?per_page=30";

/** The per-platform updater manifest asset name. */
export type UpdateManifestAsset = "latest.json" | "latest-android.json";

type GithubReleaseAsset = { name: string; browser_download_url: string };
export type GithubRelease = {
  tag_name: string;
  draft: boolean;
  assets: GithubReleaseAsset[];
};

type ParsedVersion = {
  release: [number, number, number];
  /** Empty for a stable version; SemVer §11 orders absence ABOVE presence. */
  prerelease: (string | number)[];
};

/** "v1.2.3-beta.1+build" → parsed; null for anything that isn't semver. */
export function parseVersionTag(tag: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    tag.trim(),
  );
  if (!match) return null;
  const prerelease = match[4]
    ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  return { release: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
}

/** SemVer 2.0 precedence (build metadata already discarded by the parser). */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i += 1) {
    if (a.release[i] !== b.release[i]) return a.release[i] - b.release[i];
  }
  // Same release triple: stable (no prerelease) outranks any prerelease.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const len = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const [x, y] = [a.prerelease[i], b.prerelease[i]];
    if (x === y) continue;
    // Numeric identifiers sort below alphanumeric ones; among their own kind,
    // numerically and ASCII-lexically respectively.
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  // A longer prerelease list wins when the shorter is its prefix.
  return a.prerelease.length - b.prerelease.length;
}

/**
 * The semver-largest non-draft release carrying `asset`, or null when none
 * qualifies. GitHub's list order is by date, which betas and back-ported
 * stables can both violate — hence real semver, not "first item".
 */
export function pickLatestRelease(
  releases: GithubRelease[],
  asset: UpdateManifestAsset,
): { tag: string; manifestUrl: string } | null {
  let best: { tag: string; manifestUrl: string; version: ParsedVersion } | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const version = parseVersionTag(release.tag_name);
    if (!version) continue;
    const manifest = release.assets.find((a) => a.name === asset);
    if (!manifest) continue;
    if (best === null || compareVersions(version, best.version) > 0) {
      best = { tag: release.tag_name, manifestUrl: manifest.browser_download_url, version };
    }
  }
  return best ? { tag: best.tag, manifestUrl: best.manifestUrl } : null;
}

/**
 * Resolve the beta channel's manifest URL. Null on any failure — the caller
 * falls back to the stable endpoint, so a GitHub API hiccup degrades to
 * "stable updates only", never to "no updates".
 */
export async function resolveBetaManifestUrl(
  asset: UpdateManifestAsset,
  fetchFn: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string | null> {
  try {
    const response = await fetchFn(RELEASES_API_URL, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const releases = (await response.json()) as GithubRelease[];
    if (!Array.isArray(releases)) return null;
    return pickLatestRelease(releases, asset)?.manifestUrl ?? null;
  } catch {
    return null;
  }
}
