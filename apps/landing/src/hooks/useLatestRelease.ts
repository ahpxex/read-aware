import { useState } from "react";
import {
  CURRENT_RELEASE_TAG,
  DOWNLOADS,
  detectPlatform,
  type PlatformDownload,
  type PlatformId,
} from "../lib/releases";

export type LatestReleaseState = {
  /** The shipped release tag (e.g. "v0.4.1") — a build-time constant. */
  tag: string;
  downloads: PlatformDownload[];
  /** The visitor's detected OS, used to feature the right download. */
  platform: PlatformId | null;
};

/**
 * Download links and version for the latest stable release. Everything here
 * is static: the links are stable-alias URLs GitHub resolves server-side to
 * the newest non-prerelease release, and the tag is a constant the publishing
 * pipeline bumps — so the version is right in the prerendered HTML instead of
 * blinking in when a rate-limited GitHub API call happens to succeed.
 */
export function useLatestRelease(): LatestReleaseState {
  const [state] = useState<LatestReleaseState>(() => ({
    tag: CURRENT_RELEASE_TAG,
    downloads: DOWNLOADS,
    platform: detectPlatform(),
  }));
  return state;
}
