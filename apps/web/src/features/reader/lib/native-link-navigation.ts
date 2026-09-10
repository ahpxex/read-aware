import type { ReadingSessionController } from "../../../domain/reading-session-controller";
import { errorCode } from "@read-aware/core";
import type { FoliateLinkDetail } from "./foliate-engine";

/** Run after the footnote interceptor, which claims previews synchronously.
 * One view owns these requests; retirement cancels pending jumps, not history. */
export function createNativeLinkNavigator(
  runtime: ReadingSessionController,
  identity: { bookId: string; sessionId: string; contentVersion: string },
  onError: (error: unknown) => void,
  onStart?: () => void,
) {
  const lifetime = new AbortController();
  let request = 0;
  const current = () => !lifetime.signal.aborted && runtime.snapshot().sessionId === identity.sessionId;
  return {
    handle(event: CustomEvent<FoliateLinkDetail>): Promise<void> | undefined {
      if (event.defaultPrevented) return;
      // Never let Foliate's private history handle a stale mounted-book click.
      event.preventDefault();
      if (!current()) return;
      const attempt = ++request;
      onStart?.();
      return runtime.navigate({ bookId: identity.bookId, contentVersion: identity.contentVersion, href: event.detail.href }, lifetime.signal)
        .then(() => undefined, error => {
          // Retired or superseded jumps belong to an obsolete interaction.
          if (current() && attempt === request && errorCode(error) !== "reader/superseded") onError(error);
        });
    },
    dispose: () => lifetime.abort(),
  };
}
