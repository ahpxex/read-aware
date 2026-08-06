import { useEffect, useState } from "react";
import {
  DOWNLOADS,
  detectPlatform,
  fetchLatestVersion,
  type PlatformDownload,
  type PlatformId,
} from "../lib/releases";

export type LatestReleaseState = {
  /** Release tag (e.g. "v0.2.3"), or null until the GitHub API confirms it. */
  tag: string | null;
  downloads: PlatformDownload[];
  /** The visitor's detected OS, used to feature the right download. */
  platform: PlatformId | null;
  loading: boolean;
};

/**
 * Download links for the latest stable release. The links are static
 * stable-alias URLs that GitHub resolves server-side to the newest
 * non-prerelease release, so they need no version and no network round trip.
 * The GitHub API call only fills in the release tag for display copy when it
 * responds (it is rate-limited per client IP); until then the tag stays null
 * and the copy omits it.
 */
export function useLatestRelease(): LatestReleaseState {
  const [state, setState] = useState<LatestReleaseState>(() => ({
    tag: null,
    downloads: DOWNLOADS,
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
        tag: version ? `v${version}` : null,
      }));
    });
    return () => controller.abort();
  }, []);

  return state;
}
