import { expect, test } from "bun:test";
import { ReadingModeWrites } from "./reading-mode-writes";

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("write receipts include failures that settled before indexing feedback", async () => {
  const writes = new ReadingModeWrites(); writes.start(1);
  const write = deferred(); writes.track(1, write.promise);
  write.reject(new Error("database refused"));
  await Promise.resolve();
  await expect(writes.wait(1)).rejects.toThrow("database refused");
});

test("barrier includes writes registered after feedback and while earlier writes settle", async () => {
  const writes = new ReadingModeWrites(); writes.start(1);
  const first = deferred(), second = deferred();
  let completed = false;
  const done = writes.wait(1).then(() => { completed = true; });
  writes.track(1, first.promise);
  await Promise.resolve();
  first.resolve(); writes.track(1, second.promise);
  await Promise.resolve(); await Promise.resolve();
  expect(completed).toBe(false);
  second.resolve(); await done;
  expect(completed).toBe(true);
});

test("superseding an unresolved native write promptly releases the old barrier", async () => {
  const writes = new ReadingModeWrites(); writes.start(1);
  const old = deferred(); writes.track(1, old.promise);
  const done = writes.wait(1);
  await Promise.resolve();
  writes.start(2);
  await expect(done).rejects.toMatchObject({ code: "reader/superseded" });
  old.reject(new Error("late old write"));
  await writes.wait(2);
});

test("a caller may cancel a same-configuration durability wait", async () => {
  const writes = new ReadingModeWrites(); writes.start(1);
  writes.track(1, new Promise(() => {}));
  const owner = new AbortController();
  const done = writes.wait(1, owner.signal);
  await Promise.resolve(); owner.abort(new Error("caller stopped"));
  await expect(done).rejects.toThrow("caller stopped");
});
