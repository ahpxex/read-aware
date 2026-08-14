/**
 * readaware://sync/login/<token> — the URL a sign-in email or the relay's
 * OAuth finish page uses to hand the one-time sign-in token back to the app
 * (docs/sync-engine.md §5). Parsing is pure and directly testable; the
 * subscription wraps the deep-link plugin so a caller misses neither a
 * cold-start URL (the OS launched us to serve the link — getCurrent) nor one
 * arriving while the app runs (onOpenUrl).
 */
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

const SYNC_LOGIN_PATTERN = /^readaware:\/\/sync\/login\/([^/?#]+)/i;

export function parseSyncLoginUrl(url: string): string | null {
  const match = SYNC_LOGIN_PATTERN.exec(url.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A token is minted URL-safe; a malformed escape means someone hand-edited
    // the link. Pass it through and let the relay reject it.
    return match[1];
  }
}

function firstSyncLoginToken(urls: readonly string[] | null | undefined): string | null {
  for (const url of urls ?? []) {
    const token = parseSyncLoginUrl(url);
    if (token) return token;
  }
  return null;
}

/**
 * Deliver every sync sign-in token the OS hands us. The same token can
 * surface through both the startup snapshot and the open event on some
 * platforms — callers must treat delivery as at-least-once.
 */
export async function subscribeSyncLoginTokens(
  onToken: (token: string) => void,
): Promise<() => void> {
  const unlisten = await onOpenUrl((urls) => {
    const token = firstSyncLoginToken(urls);
    if (token) onToken(token);
  });
  // AFTER subscribing, drain the startup URL — the other order can drop a
  // link that lands between the two calls.
  const startup = firstSyncLoginToken(await getCurrent());
  if (startup) onToken(startup);
  return unlisten;
}
