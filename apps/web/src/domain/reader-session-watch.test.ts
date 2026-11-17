import { expect, test } from "bun:test";
import type { ReadingSessionSnapshot } from "@read-aware/core";
import { stampEventCause } from "../platform/domain-actor";
import { watchReaderSession } from "./reader-session-watch";

const state = (patch: Partial<ReadingSessionSnapshot>): ReadingSessionSnapshot =>
  stampEventCause(
    { revision: 1, sessionId: "s1", bookId: "b1", status: "ready", location: null, visibleText: "", ...patch },
    "system",
  );

function reader(initial?: ReadingSessionSnapshot) {
  const listeners = new Set<(snapshot: ReadingSessionSnapshot) => void>();
  return {
    listeners,
    publish: (snapshot: ReadingSessionSnapshot) => {
      for (const listener of [...listeners]) listener(snapshot);
    },
    observe(listener: (snapshot: ReadingSessionSnapshot) => void) {
      listeners.add(listener);
      if (initial) listener(initial);
      return () => listeners.delete(listener);
    },
  };
}

test("a binding ends once when the reader leaves its session, book or content", () => {
  for (const change of [
    { sessionId: "s2" },
    { bookId: "b2" },
    { status: "loading" as const },
    { location: { contentVersion: "v2" } as ReadingSessionSnapshot["location"] },
  ]) {
    const source = reader();
    const ends: unknown[] = [];
    watchReaderSession(source, { sessionId: "s1", bookId: "b1", contentVersion: "v1" }, (origin) => ends.push(origin));
    source.publish(state({ location: { contentVersion: "v1" } as ReadingSessionSnapshot["location"] }));
    expect(ends).toHaveLength(0);
    source.publish(state({ location: { contentVersion: "v1" } as ReadingSessionSnapshot["location"], ...change }));
    source.publish(state({ sessionId: "s3" }));
    expect(ends).toHaveLength(1);
    expect(source.listeners.size).toBe(0);
  }
});

test("a synchronous first report that already left the session ends at once and unsubscribes", () => {
  const source = reader(state({ status: "idle", sessionId: null }));
  let ended = 0;
  let stop: (() => void) | undefined;
  stop = watchReaderSession(source, { sessionId: "s1" }, () => {
    ended++;
    stop?.();
  });
  stop();
  expect(ended).toBe(1);
  expect(source.listeners.size).toBe(0);
});
