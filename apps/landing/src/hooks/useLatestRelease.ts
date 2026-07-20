import { useEffect, useState } from "react";
import {
  BAKED_VERSION,
  buildDownloads,
  detectPlatform,
  fetchLatestVersion,
  type PlatformDownload,
  type PlatformId,
} from "../lib/releases";

export type LatestReleaseState = {
  /** Release tag (e.g. "v0.2.3"). */
  tag: string | null;
  downloads: PlatformDownload[];
  /** The visitor's detected OS, used to feature the right download. */
  platform: PlatformId | null;
  loading: boolean;
};

/**
 * Download links for the latest GitHub release. Starts from the build-time
 * baked version — direct version-stamped installer URLs, no network round
 * trip. The GitHub API then refines them when it responds (it may know a newer
 * release than this deployed landing); a failed API request (it's rate-limited
 * per client IP) keeps the baked set — the buttons still download directly.
 */
export function useLatestRelease(): LatestReleaseState {
  const [state, setState] = useState<LatestReleaseState>(() => ({
    tag: `v${BAKED_VERSION}`,
    downloads: buildDownloads(BAKED_VERSION),
    platform: detectPlatform(),
    loading: true,
  }));

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestVersion(controller.signal).then((version) => {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        tag: version ? `v${version}` : previous.tag,
        downloads: version ? buildDownloads(version) : previous.downloads,
      }));
    });
    return () => controller.abort();
  }, []);

  return state;
}
