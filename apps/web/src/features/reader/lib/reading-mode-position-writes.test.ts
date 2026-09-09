import { expect, test } from "bun:test";
import { ReadingModePositionWrites } from "./reading-mode-position-writes";

const position = { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "unit" } };
const signal = () => new AbortController().signal;
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a position receipt retains early failure and an explicit later action can retry it", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  const first = deferred(), retried = deferred();
  writes.track(1, position, first.promise, () => writes.track(1, position, retried.promise, () => {}));
  first.reject(new Error("disk failed")); await Promise.resolve();
  await expect(writes.wait(1, position, signal())).rejects.toThrow("disk failed");
  let saved = false;
  const recovery = writes.wait(1, position, signal(), writes.retryable()).then(() => { saved = true; });
  await Promise.resolve(); expect(saved).toBe(false);
  retried.resolve(); await recovery;
  expect(saved).toBe(true);
});

test("a new failure cannot disappear into an automatic retry", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  const first = deferred(); let retries = 0;
  writes.track(1, position, first.promise, () => { retries++; });
  const done = writes.wait(1, position, signal(), writes.retryable());
  first.reject(new Error("fresh failure"));
  await expect(done).rejects.toThrow("fresh failure");
  expect(retries).toBe(0);
});

test("equivalent position replacement still waits for the newest exact receipt", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  const first = deferred(), next = deferred();
  writes.track(1, position, first.promise, () => {});
  let saved = false;
  const done = writes.wait(1, position, signal()).then(() => { saved = true; });
  await Promise.resolve();
  writes.track(1, position, next.promise, () => {});
  first.reject(new Error("obsolete position write"));
  await Promise.resolve(); await Promise.resolve(); expect(saved).toBe(false);
  next.resolve(); await done;
  expect(saved).toBe(true);
});

test("different position/content and mode replacement cannot acknowledge an old target", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  writes.track(1, position, new Promise(() => {}), () => {});
  const work = writes.wait(1, position, signal()); await Promise.resolve();
  writes.track(1, { ...position, location: { ...position.location, contentVersion: "v2" } }, Promise.resolve(), () => {});
  await expect(work).rejects.toMatchObject({ code: "reader/superseded" });
  writes.start(2);
  await expect(writes.wait(1, position, signal())).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(writes.wait(2, position, signal())).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("cancelling a waiter releases it without waiting for an unresponsive storage call", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  writes.track(1, position, new Promise(() => {}), () => {});
  const owner = new AbortController();
  const done = writes.wait(1, position, owner.signal);
  await Promise.resolve(); owner.abort(new Error("caller cancelled"));
  await expect(done).rejects.toThrow("caller cancelled");
});

test("retirement rejects outstanding and same-position waiters even without a mode change", async () => {
  const writes = new ReadingModePositionWrites(); writes.start(1);
  writes.track(1, position, new Promise(() => {}), () => {});
  const done = writes.wait(1, position, signal());
  await Promise.resolve(); writes.retire();
  await expect(done).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(writes.wait(1, null, signal())).rejects.toMatchObject({ code: "reader/superseded" });
  writes.start(2);
  writes.track(2, position, Promise.resolve(), () => {});
  await writes.wait(2, position, signal());
});
