import { useEffect, useState } from "react";
import {
  buildDownloads,
  detectPlatform,
  fetchLatestRelease,
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
 * Resolve live download links from the latest GitHub release. Starts with an
 * empty (releases-page fallback) set so the UI is usable immediately, then fills
 * in direct installer URLs once the API responds. A failed request leaves the
 * fallback in place rather than surfacing an error — the buttons still work.
 */
export function useLatestRelease(): LatestReleaseState {
  const [state, setState] = useState<LatestReleaseState>(() => ({
    tag: null,
    downloads: buildDownloads([]),
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
