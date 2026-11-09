import { afterEach, expect, test } from "bun:test";
import type { ReadingSessionSnapshot } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { canStepReadingHistory, stepReadingHistory } from "./reading-history";

const originals = {
  snapshot: readingRuntime.snapshot.bind(readingRuntime),
  back: readingRuntime.back.bind(readingRuntime),
  forward: readingRuntime.forward.bind(readingRuntime),
};
afterEach(() => Object.assign(readingRuntime, originals));

const session = (status: ReadingSessionSnapshot["status"], canGoBack: boolean, canGoForward: boolean) =>
  ({
    status,
    sessionId: "s1",
    bookId: "b1",
    history: { canGoBack, canGoForward },
  }) as ReadingSessionSnapshot;

test("history steps only from a ready session that has somewhere to go", () => {
  expect(canStepReadingHistory(session("ready", true, false), "back")).toBe(true);
  expect(canStepReadingHistory(session("ready", true, false), "forward")).toBe(false);
  expect(canStepReadingHistory(session("loading", true, true), "back")).toBe(false);
});

test("a step goes through the session with its guard, and nowhere-to-go is not an error", async () => {
  const calls: unknown[] = [];
  readingRuntime.snapshot = () => session("ready", true, false);
  readingRuntime.back = (async (_signal, guard, origin) => {
    calls.push(["back", guard, origin]);
    return {} as never;
  }) as typeof readingRuntime.back;
  readingRuntime.forward = (async () => {
    calls.push(["forward"]);
    return {} as never;
  }) as typeof readingRuntime.forward;
  expect(await stepReadingHistory("back")).toBe(true);
  expect(await stepReadingHistory("forward")).toBe(false);
  expect(calls).toEqual([["back", { sessionId: "s1", bookId: "b1" }, "user"]]);
});
