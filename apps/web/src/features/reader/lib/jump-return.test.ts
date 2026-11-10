import { expect, test } from "bun:test";
import type { ReadingLocation } from "@read-aware/core";
import type { ReadingHistoryMove } from "../../../domain/reading-session-controller";
import { createPageMemory, jumpReturnAfter, type JumpReturn } from "./jump-return";

const at = (cfi: string): ReadingLocation => ({ bookId: "book", contentVersion: "v", cfi });
const move = (kind: ReadingHistoryMove["kind"], from: string, to: string, sessionId = "s1"): ReadingHistoryMove => ({
  sessionId,
  kind,
  from: at(from),
  to: at(to),
});
const noPage = () => null;

test("a jump offers the place it left; further jumps keep the first place", () => {
  const first = jumpReturnAfter(null, move("jump", "reading", "hit-1"), () => 98);
  expect(first).toEqual({ sessionId: "s1", location: at("reading"), page: 98 });
  // The next hit, opened from the first: the way back is still where the reading stopped.
  expect(jumpReturnAfter(first, move("jump", "hit-1", "hit-2"), () => 120)).toBe(first);
});

test("once the offer is gone, the next jump offers the place it leaves", () => {
  // Dismissed or used at hit-2, then reading on to "later" and jumping again.
  expect(jumpReturnAfter(null, move("jump", "later", "hit-3"), noPage)).toEqual({
    sessionId: "s1",
    location: at("later"),
    page: null,
  });
});

test("stepping back or forward through the history ends the offer", () => {
  const offer: JumpReturn = { sessionId: "s1", location: at("reading"), page: 98 };
  expect(jumpReturnAfter(offer, move("back", "hit-1", "reading"), noPage)).toBeNull();
  expect(jumpReturnAfter(offer, move("forward", "reading", "hit-1"), noPage)).toBeNull();
  expect(jumpReturnAfter(null, move("back", "hit-1", "reading"), noPage)).toBeNull();
});

test("an offer from another reading session is replaced, not kept", () => {
  const stale: JumpReturn = { sessionId: "s0", location: at("old-book-place"), page: 3 };
  expect(jumpReturnAfter(stale, move("jump", "reading", "hit-1"), noPage)).toEqual({
    sessionId: "s1",
    location: at("reading"),
    page: null,
  });
});

test("a place's page is the one the reader reported there, while it is recent", () => {
  const memory = createPageMemory();
  const cursor = (anchor: string, current: number) => ({ anchor, location: { current, total: 1885 } });
  memory.remember(cursor("reading", 100));
  memory.remember(cursor("hit-1", 120));
  expect(memory.pageAt(at("reading"))).toBe(100);
  expect(memory.pageAt(at("hit-1"))).toBe(120);
  // The same place reported again (a reflow renumbered it): the latest number.
  memory.remember(cursor("reading", 101));
  expect(memory.pageAt(at("reading"))).toBe(101);
  // Never seen, no place to key by, or a book without pages: no page to name.
  expect(memory.pageAt(at("elsewhere"))).toBeNull();
  expect(memory.pageAt({ bookId: "book", contentVersion: "v", fraction: 0.5 })).toBeNull();
  memory.remember(null);
  memory.remember({ anchor: "no-pages" });
  memory.remember({ location: { current: 4, total: 9 } });
  expect(memory.pageAt(at("no-pages"))).toBeNull();
  // Places from long ago are forgotten; the recent ones stay.
  for (let index = 0; index < 40; index++) memory.remember(cursor(`turn-${index}`, 200 + index));
  expect(memory.pageAt(at("reading"))).toBeNull();
  expect(memory.pageAt(at("turn-39"))).toBe(239);
  expect(memory.pageAt(at("turn-8"))).toBe(208);
  expect(memory.pageAt(at("turn-7"))).toBeNull();
});
