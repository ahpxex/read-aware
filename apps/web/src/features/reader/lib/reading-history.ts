/**
 * Back / forward through the reading session's jump history — the places a
 * chapter jump, a search hit or a link left behind (page turns are not jumps;
 * see `recordJump` in the session controller). One entry point for the reader
 * shortcut, the command palette and the contents panel.
 */
import type { ReadingSessionSnapshot } from "@read-aware/core";
import type { DomainActor } from "../../../platform/domain-actor";
import { readingRuntime } from "../../../domain/reading-runtime";

export type ReadingHistoryDirection = "back" | "forward";

export function canStepReadingHistory(session: ReadingSessionSnapshot, direction: ReadingHistoryDirection): boolean {
  return (
    session.status === "ready" && (direction === "back" ? session.history.canGoBack : session.history.canGoForward)
  );
}

/** Step once; resolves false (without error) when there is nowhere to go. */
export async function stepReadingHistory(
  direction: ReadingHistoryDirection,
  origin: DomainActor = "user",
  signal?: AbortSignal,
): Promise<boolean> {
  const session = readingRuntime.snapshot();
  if (!session.sessionId || !session.bookId || !canStepReadingHistory(session, direction)) return false;
  const guard = { sessionId: session.sessionId, bookId: session.bookId };
  await (direction === "back"
    ? readingRuntime.back(signal, guard, origin)
    : readingRuntime.forward(signal, guard, origin));
  return true;
}
