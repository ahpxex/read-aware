import { expect, test } from "bun:test";
import { AppError, type BookTextSnapshot, type BookTextTaskSnapshot } from "@read-aware/core";
import { BookTextTaskOwner } from "./book-text-tasks";
import type { TextPreparationOptions } from "./book-text-repository";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const state = (bookId = "book", status: BookTextSnapshot["status"] = "unprepared"): BookTextSnapshot => ({ bookId, contentVersion: "sha256:a", status, text: "unknown", chapterCount: 0, progress: null });
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(lifetime?: AbortSignal) {
  const work: { options: TextPreparationOptions; result: ReturnType<typeof deferred<BookTextSnapshot>> }[] = [];
  const warnings: unknown[] = [];
  let readError: unknown;
  const owner = new BookTextTaskOwner({
    snapshot: async bookId => { if (readError) throw readError; return state(bookId); },
    prepare: async (_bookId, options = {}) => { const result = deferred<BookTextSnapshot>(); work.push({ options, result }); return result.promise; },
  }, (_message, error) => { warnings.push(error); }, lifetime);
  return { owner, work, warnings, failRead: (error: unknown) => { readError = error; } };
}

test("task receipts are actor/book scoped, cloned, and not completion acknowledgements", async () => {
  const h = harness(); const other = harness();
  const started = await h.owner.start("book");
  expect(started.status).toBe("running"); expect(started.revision).toBe(1);
  expect(h.owner.list("book")).toHaveLength(1); expect(h.owner.list("other")).toEqual([]);
  expect(() => other.owner.get("book", started.taskId)).toThrow();
  expect(() => h.owner.cancel("other", started.taskId)).toThrow();
  started.status = "completed";
  expect(h.owner.get("book", started.taskId).status).toBe("running");
  h.work[0]!.options.progress?.({ ...state(), status: "preparing", progress: { total: 4, completed: 2, failed: 0, unsupported: 0 } });
  expect(h.owner.get("book", started.taskId).textState.progress?.completed).toBe(2);
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  const completed = h.owner.get("book", started.taskId);
  expect(completed.status).toBe("completed"); expect(completed.revision).toBeGreaterThan(1);
  expect(h.owner.cancel("book", started.taskId)).toEqual(completed);
});

test("cancel is immediate and idempotent; late success and failure cannot replace cancellation", async () => {
  for (const reject of [false, true]) {
    const h = harness(); const started = await h.owner.start("book");
    const cancelled = h.owner.cancel("book", started.taskId);
    expect(cancelled.status).toBe("cancelled"); expect(h.work[0]!.options.signal!.aborted).toBe(true);
    expect(h.owner.cancel("book", started.taskId)).toEqual(cancelled);
    if (reject) h.work[0]!.result.reject(Error("late failure")); else h.work[0]!.result.resolve(state("book", "ready"));
    await settle(); expect(h.owner.get("book", started.taskId)).toEqual(cancelled);
  }
});

test("failed requests preserve codes; a failed diagnostic read is not an empty successful result", async () => {
  const h = harness(); const started = await h.owner.start("book");
  h.failRead(new AppError("db/locked", "diagnostic failed"));
  h.work[0]!.result.reject(new AppError("fs/permission", "raw private file")); await settle();
  expect(h.owner.get("book", started.taskId)).toMatchObject({ status: "failed", errorCode: "fs/permission" });
  expect(JSON.stringify(h.owner.get("book", started.taskId))).not.toContain("raw private"); expect(h.warnings).toHaveLength(2);
  await expect(h.owner.start("next")).rejects.toMatchObject({ code: "db/locked" });
  expect(h.owner.list("next")).toEqual([]);
});

test("task observation coalesces slow callbacks and preserves the terminal revision", async () => {
  const h = harness(); const started = await h.owner.start("book");
  const gate = deferred<void>(); const seen: BookTextTaskSnapshot[] = [];
  const stop = h.owner.observe("book", started.taskId, async snapshot => { seen.push(snapshot); if (seen.length === 1) await gate.promise; });
  for (let completed = 0; completed < 30; completed++) h.work[0]!.options.progress?.({ ...state("book", "preparing"), progress: { total: 30, completed, failed: 0, unsupported: 0 } });
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  expect(seen).toHaveLength(1); gate.resolve(); await settle();
  expect(seen).toHaveLength(2); expect(seen[1]!.status).toBe("completed"); expect(seen[1]!.revision).toBeGreaterThan(seen[0]!.revision);
  stop(); stop();
  const failureStop = h.owner.observe("book", started.taskId, () => { throw Error("observer failed"); });
  await settle(); expect(h.warnings).toHaveLength(1); failureStop();
});

test("disposing an actor stops all observers and requests, without reviving handles in a new generation", async () => {
  const lifetime = new AbortController(); const h = harness(lifetime.signal);
  const started = await h.owner.start("book"); const seen: number[] = [];
  h.owner.observe("book", started.taskId, snapshot => { seen.push(snapshot.revision); });
  lifetime.abort(); expect(h.work[0]!.options.signal!.aborted).toBe(true);
  h.work[0]!.result.resolve(state("book", "ready")); await settle(); expect(seen).toHaveLength(1);
  expect(() => h.owner.get("book", started.taskId)).toThrow();
  expect(() => harness().owner.get("book", started.taskId)).toThrow();
  await expect(h.owner.start("book")).rejects.toMatchObject({ code: "library/text-cancelled" });
});

test("active work, terminal history and observer counts are bounded", async () => {
  const h = harness();
  for (let i = 0; i < 16; i++) await h.owner.start("book");
  await expect(h.owner.start("book")).rejects.toMatchObject({ code: "library/text-task-limit" });
  for (const work of h.work) work.result.resolve(state("book", "ready")); await settle();
  const first = h.owner.list("book")[0]!;
  const stops = Array.from({ length: 16 }, () => h.owner.observe("book", first.taskId, () => {}));
  expect(() => h.owner.observe("book", first.taskId, () => {})).toThrow(); for (const stop of stops) stop();
  for (let i = 0; i < 50; i++) { await h.owner.start("book"); h.work.at(-1)!.result.resolve(state("book", "ready")); await settle(); }
  expect(h.owner.list("book")).toHaveLength(64); expect(() => h.owner.get("book", first.taskId)).toThrow();
  h.owner.dispose();
});

test("invalid options and disposal during preflight do not launch work", async () => {
  const h = harness();
  await expect(h.owner.start("book", { rebuild: "yes" } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  await expect(h.owner.start("book", { unknown: true } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  const start = h.owner.start("book"); h.owner.dispose();
  await expect(start).rejects.toMatchObject({ code: "library/text-cancelled" }); expect(h.work).toHaveLength(0);
});
