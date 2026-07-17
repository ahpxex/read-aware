import { useEffect, useState } from "react";
import {
  buildDownloads,
  detectPlatform,
  fetchLatestRelease,
  stableDownloads,
  type PlatformDownload,
  type PlatformId,
} from "../lib/releases";

export type LatestReleaseState = {
  /** Release tag (e.g. "v0.2.3"), or null until the API responds. */
  tag: string | null;
  downloads: PlatformDownload[];
  /** The visitor's detected OS, used to feature the right download. */
  platform: PlatformId | null;
  loading: boolean;
};

/**
 * Download links for the latest GitHub release. Starts with the stable alias
 * URLs, which are direct installer downloads with no network round trip; the
 * GitHub API then refines them with the release tag and version-stamped
 * filenames. A failed API request (it's rate-limited per client IP) keeps the
 * stable set — the buttons still download directly.
 */
export function useLatestRelease(): LatestReleaseState {
  const [state, setState] = useState<LatestReleaseState>(() => ({
    tag: null,
    downloads: stableDownloads(),
    platform: detectPlatform(),
    loading: true,
  }));

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestRelease(controller.signal).then((release) => {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        tag: release?.tag ?? previous.tag,
        downloads: release ? buildDownloads(release.assets) : previous.downloads,
      }));
    });
    return () => controller.abort();
  }, []);

  return state;
}
