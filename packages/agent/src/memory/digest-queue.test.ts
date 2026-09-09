import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError } from "@read-aware/core";
import { BookDigestQueue } from "./digest-queue";
import { digestBookCatchUp, digestBookTick, type DigestBookTickInput } from "./graph-upkeep";
import { createInMemoryDeps } from "../testing/fixtures";
import { runMemoryBuild } from "./build-policy";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
const model = { id: "fixture" } as DigestBookTickInput["model"];
const reply = () => fauxAssistantMessage('{"summary":"Committed","characters":[],"relations":[]}');
const fixture = () => createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative" }],
  chapters: { b: [0,1].map(i => ({ title: `Chapter ${i}`, text: `Text ${i}`, hrefs: [`ch${i}`] })) } });

test("same book is FIFO, other books remain independent and rejection releases the lane", async () => {
  const queue = new BookDigestQueue(), release = deferred(), order: string[] = [];
  const a = queue.run("a", async () => { order.push("a1"); await release.promise; throw new AppError("db/error", "Failure"); });
  const observed = a.catch(error => error);
  const b = queue.run("a", async () => { order.push("a2"); return 2; });
  expect(await queue.run("b", async () => { order.push("b"); return 3; })).toBe(3);
  expect(order).toEqual(["a1","b"]);
  release.resolve(); expect(await observed).toMatchObject({ code: "db/error" }); expect(await b).toBe(2);
  expect(order).toEqual(["a1","b","a2"]);
});

test("queued cancellation never executes work and the 64-request bound recovers capacity", async () => {
  const queue = new BookDigestQueue(), release = deferred(), controller = new AbortController(); let called = false;
  const active = queue.run("a", async () => release.promise);
  const queued = queue.run("a", async () => { called = true; }, controller.signal);
  controller.abort(new AppError("memory/cancelled", "Cancelled"));
  await expect(queued).rejects.toMatchObject({ code: "memory/cancelled" }); expect(called).toBe(false);
  const rest = Array.from({ length: 63 }, () => queue.run("a", async () => {}));
  await expect(queue.run("b", async () => {})).rejects.toMatchObject({ code: "memory/task-limit" });
  release.resolve(); await Promise.all([active,...rest]);
  expect(await queue.run("b", async () => "recovered")).toBe("recovered");
  await expect(queue.run("a", async () => { called = true; }, controller.signal)).rejects.toBeDefined();
  expect(called).toBe(false);
});

test("overlapping tick and catch-up reread persisted digests instead of duplicating inference", async () => {
  const { deps } = fixture(), started = deferred(), release = deferred(); let calls = 0;
  const complete: DigestBookTickInput["complete"] = async () => { if (++calls === 1) { started.resolve(); await release.promise; } return reply(); };
  const tick = digestBookTick({ deps, bookId: "b", model, maxChapters: 1, complete });
  await started.promise;
  const catchUp = digestBookCatchUp({ deps, bookId: "b", model, complete });
  await nextTurn(); expect(calls).toBe(1);
  release.resolve(); expect(await tick).toMatchObject({ digested: 1, remaining: 1 });
  expect(await catchUp).toMatchObject({ status: "complete", attempted: 1, digested: 1 });
  expect(calls).toBe(2);
});

test("an aborted active write keeps the book lane until its actual receipt settles", async () => {
  const { deps } = fixture(), started = deferred(), release = deferred(), controller = new AbortController();
  const save = deps.bookMemory.saveDigest; let calls = 0, saving = 0;
  deps.bookMemory.saveDigest = async (id, digest, revision) => {
    if (++saving === 1) { started.resolve(); await release.promise; }
    // This fixture models a dispatched native operation, which cannot be rolled back by abort.
    await save(id, digest, revision);
  };
  const complete = async () => { calls++; return reply(); };
  const run = (signal?: AbortSignal) => runMemoryBuild(deps, operation => digestBookCatchUp({ deps: operation.protect(deps), bookId: "b", model,
    complete: operation.complete(complete), signal: operation.signal }), signal);
  const first = run(controller.signal), observed = first.catch(error => error);
  await started.promise; controller.abort(new AppError("memory/cancelled", "Cancelled"));
  const next = run(); await nextTurn(); expect(calls).toBe(1);
  release.resolve(); expect(await observed).toMatchObject({ code: "memory/cancelled" });
  expect(await next).toMatchObject({ status: "complete", digested: 1 });
  expect(calls).toBe(2); expect(await deps.bookMemory.listDigests("b")).toHaveLength(2);
});

test("abandoned protected reads release the lane and cannot start late inference", async () => {
  const { deps } = fixture(), started = deferred(), release = deferred(), controller = new AbortController();
  const get = deps.library.getBook; let reads = 0, calls = 0;
  deps.library.getBook = async id => { if (++reads === 1) { started.resolve(); await release.promise; } return get(id); };
  const complete = async () => { calls++; return reply(); };
  const run = (signal?: AbortSignal) => runMemoryBuild(deps, operation => digestBookCatchUp({ deps: operation.protect(deps), bookId: "b", model,
    complete: operation.complete(complete), signal: operation.signal }), signal);
  const first = run(controller.signal); await started.promise; controller.abort();
  await expect(first).rejects.toBeDefined();
  expect(await run()).toMatchObject({ status: "complete", digested: 2 });
  release.resolve(); await nextTurn(); expect(calls).toBe(2);
});

test("queued requests freeze the target and budget rather than following caller mutation", async () => {
  const { deps } = fixture(), release = deferred();
  const blocking = deps.bookMemory.runExclusive("b", async () => release.promise);
  const request = { deps, bookId: "b", model, maxChapters: 1, complete: async () => reply() };
  const queued = digestBookTick(request);
  request.bookId = "other"; request.maxChapters = 0;
  release.resolve(); await blocking;
  expect(await queued).toMatchObject({ digested: 1, remaining: 1 });
  expect(await deps.bookMemory.listDigests("b")).toHaveLength(1);
  expect(await deps.bookMemory.listDigests("other")).toHaveLength(0);
});
