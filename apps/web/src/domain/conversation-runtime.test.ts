import { expect, test } from "bun:test";
import { ConversationRuntime } from "./conversation-runtime";

test("conversation clear blocks new turns and waits for the aborted turn's final persistence", async () => {
  const errors: unknown[] = [], runtime = new ConversationRuntime(error => errors.push(error));
  let finish!: () => void, aborted = false, cleared = false;
  const work = new Promise<void>(resolve => { finish = resolve; });
  runtime.track("thread-a", () => { aborted = true; }, work);
  expect(runtime.canStart("thread-a")).toBe(false);
  const clearing = runtime.quiesce("thread-a", async () => { cleared = true; });
  expect(aborted).toBe(true); expect(cleared).toBe(false);
  await expect(runtime.quiesce("thread-a", async () => {})).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(runtime.canStart("thread-b")).toBe(true);
  finish(); await clearing; expect(cleared).toBe(true); expect(runtime.canStart("thread-a")).toBe(true); expect(errors).toEqual([]);
});
test("old session disposal cannot remove a replacement and cancelled/failed drains do not clear", async () => {
  const runtime = new ConversationRuntime(() => {}), changes: number[] = [];
  const off = runtime.observe(() => changes.push(runtime.revision));
  const old = runtime.bind({ kind: "book", id: "b1" });
  const current = runtime.bind({ kind: "book", id: "b1" });
  old.dispose(); current.update({ loading: false, streaming: true, messageCount: 2 });
  const snapshot = runtime.snapshot(); snapshot[0].messageCount = 9;
  expect(runtime.snapshot()[0].messageCount).toBe(2);
  let reject!: (error: unknown) => void;
  runtime.track("b1", () => {}, new Promise<void>((_, fail) => { reject = fail; }));
  let cleared = false;
  const clear = runtime.quiesce("b1", async () => { cleared = true; });
  reject(Error("disk write failed")); await expect(clear).rejects.toThrow("disk write failed");
  expect(cleared).toBe(false); expect(runtime.canStart("b1")).toBe(true);
  const abort = new AbortController(); abort.abort(Error("cancelled"));
  await expect(runtime.quiesce("b1", async () => { cleared = true; }, abort.signal)).rejects.toThrow("cancelled");
  off(); const count = changes.length; current.dispose(); expect(changes).toHaveLength(count); expect(runtime.snapshot()).toEqual([]);
});
