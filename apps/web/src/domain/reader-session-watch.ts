import type { ReadingSessionSnapshot } from "@read-aware/core";
import { actorFromEvent, type DomainActor } from "../platform/domain-actor";

/** The reader session a binding belongs to. `contentVersion`, when given,
 * also ends the binding once the open book's content changes. */
export type ReaderSessionIdentity = { sessionId: string; bookId?: string; contentVersion?: string };

function stillBound(state: ReadingSessionSnapshot, identity: ReaderSessionIdentity): boolean {
  return (
    state.status === "ready" &&
    state.sessionId === identity.sessionId &&
    (identity.bookId === undefined || state.bookId === identity.bookId) &&
    (!("contentVersion" in identity) || state.location?.contentVersion === identity.contentVersion)
  );
}

/**
 * Calls `end` once, with the cause of the change, when the reader leaves the
 * bound session (another session, another book, not ready, or new content).
 * Every reader-bound presentation (panels, image viewer, previews, emphasis)
 * ends on the same rule. The returned stop is idempotent; `end` may call it.
 * An observer that reports synchronously on subscribe is handled.
 */
export function watchReaderSession(
  reading: { observe(listener: (state: ReadingSessionSnapshot) => void): () => void },
  identity: ReaderSessionIdentity,
  end: (origin: DomainActor) => void,
): () => void {
  let unobserve: (() => void) | undefined;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    unobserve?.();
  };
  unobserve = reading.observe((state) => {
    if (done || stillBound(state, identity)) return;
    stop();
    end(actorFromEvent(state));
  });
  if (done) unobserve();
  return stop;
}
