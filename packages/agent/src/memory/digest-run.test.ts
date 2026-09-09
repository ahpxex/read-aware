import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { digestMissingChapters } from "./digest-run";
import { digestBookCatchUp, digestBookTick } from "./graph-upkeep";
import { extractChapterDigest } from "./chapter-digest";

const model = { id: "fixture" } as Model<Api>;
const reply = () => fauxAssistantMessage('{"summary":"A chapter","characters":[],"relations":[]}');
const fixture = () => createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative" }],
  chapters: { b: Array.from({ length: 5 }, (_, index) => ({ title: `Chapter ${index}`, text: `Text ${index}`, hrefs: [`ch${index}`] })) } });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test("catch-up passes empty and failing predecessors once, reports partial, then retries only missing rows", async () => {
  const { deps } = fixture(), original = deps.bookText.getChapterText, attempted: number[] = [], warnings: unknown[] = [];
  deps.log = { warn: (...args) => { warnings.push(args); }, error() {} };
  deps.bookText.getChapterText = async (id, index) => {
    attempted.push(index);
    if (index === 0) return "";
    if (index === 1) throw new AppError("db/locked", "PRIVATE");
    return original(id, index);
  };
  const report = await digestBookCatchUp({ deps, bookId: "b", model, concurrency: 2, complete: async () => reply() });
  expect(report).toEqual({ status: "partial", eligible: 5, attempted: 5, digested: 3, remaining: 2, emptyChapters: [0], failures: [{ chapterIndex: 1, errorCode: "db/locked" }] });
  expect(attempted.sort()).toEqual([0, 1, 2, 3, 4]); expect(warnings).toHaveLength(1);
  deps.bookText.getChapterText = original;
  const retry = await digestBookCatchUp({ deps, bookId: "b", model, complete: async () => reply() });
  expect(retry).toMatchObject({ status: "complete", attempted: 2, digested: 2, remaining: 0 });
  expect(await digestBookCatchUp({ deps, bookId: "b", model, complete: async () => { throw Error("Must not infer"); } })).toMatchObject({ status: "complete", attempted: 0 });
});

test("read failures, unknown bounds and no TOC never report backlog complete", async () => {
  const { deps, stores } = fixture();
  deps.bookText.getToc = async () => { throw new AppError("db/locked", "PRIVATE"); };
  await expect(digestBookTick({ deps, bookId: "b", model, complete: async () => reply() })).rejects.toMatchObject({ code: "db/locked" });
  deps.bookText.getToc = async () => [];
  expect(await digestBookTick({ deps, bookId: "b", model, complete: async () => reply() })).toMatchObject({ status: "unavailable", reason: "no-toc" });
  stores.books[0]!.status = "reading";
  expect(await digestBookTick({ deps, bookId: "b", model, complete: async () => reply() })).toMatchObject({ status: "unavailable", reason: "boundary-unknown" });
  await expect(digestBookTick({ deps, bookId: "missing", model, complete: async () => reply() })).rejects.toMatchObject({ code: "reader/book-not-found" });
});

test("incomplete automatic classification remains partial without persisting its non-stop answer", async () => {
  const { deps, stores } = fixture(); stores.books[0]!.narrativity = undefined;
  let calls = 0;
  const report = await digestBookCatchUp({ deps, bookId: "b", model, complete: async () => calls++ === 0
    ? { ...fauxAssistantMessage('{"narrativity":"expository","confidence":0.99}'), stopReason: "length" } : reply() });
  expect(stores.books[0]!.narrativity).toBeUndefined();
  expect(report).toMatchObject({ status: "partial", reason: "classification-pending", digested: 5, remaining: 0 });
  expect((await deps.bookMemory.listDigests("b")).every(d => d.flavor === "narrative")).toBe(true);
});

test("model termination/invalid payload and write failures stay pending without losing sibling successes", async () => {
  const { deps } = fixture(), save = deps.bookMemory.saveDigest;
  deps.bookMemory.saveDigest = async (id, digest, revision, signal) => { if (digest.chapterIndex === 2) throw new AppError("db/locked", "PRIVATE"); await save(id, digest, revision, signal); };
  const report = await digestBookCatchUp({ deps, bookId: "b", model, concurrency: 3, complete: async (_model, context) => {
    const text = JSON.stringify(context.messages);
    if (text.includes("Chapter #0")) return { ...reply(), stopReason: "length" };
    if (text.includes("Chapter #1")) return fauxAssistantMessage("null");
    return reply();
  } });
  expect(report).toMatchObject({ status: "partial", attempted: 5, digested: 2, remaining: 3,
    failures: [{ chapterIndex: 0, errorCode: "ai/provider" }, { chapterIndex: 1, errorCode: "ai/provider" }, { chapterIndex: 2, errorCode: "db/locked" }] });
  expect((await deps.bookMemory.listDigests("b")).map(d => d.chapterIndex).sort()).toEqual([3, 4]);
});

test("repaired early chapters never receive later stored names or aliases", async () => {
  const { deps } = fixture();
  await deps.bookMemory.saveDigest("b", { chapterIndex: 4, summary: "Future", characters: [{ name: "FUTURE_SECRET", aliases: ["FUTURE_ALIAS"] }], relations: [], digestVersion: 2, flavor: "narrative" }, (await deps.bookMemory.inspectDigest("b", 4))!.revision);
  const report = await digestMissingChapters({ ...deps, bookId: "b", beforeChapterIndex: 5, maxChapters: 1, model, complete: async (_model, context) => {
    expect(context.systemPrompt).not.toContain("FUTURE_SECRET"); expect(context.systemPrompt).not.toContain("FUTURE_ALIAS"); return reply();
  } });
  expect(report).toMatchObject({ status: "partial", digested: 1, remaining: 3 });
});

test("cancellation drains active work, prevents late saves/new chapters and preserves an already dispatched write", async () => {
  const { deps } = fixture(), controller = new AbortController(), started = deferred(), release = deferred();
  let calls = 0;
  const task = digestBookCatchUp({ deps, bookId: "b", model, concurrency: 2, signal: controller.signal, complete: async () => {
    if (++calls === 2) started.resolve(); await release.promise; return reply();
  } });
  let settled = false; void task.then(() => { settled = true; }, () => { settled = true; });
  await started.promise; controller.abort(new AppError("memory/cancelled", "Cancelled"));
  await Promise.resolve(); expect(settled).toBe(false);
  release.resolve(); await expect(task).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(calls).toBe(2); expect(await deps.bookMemory.listDigests("b")).toHaveLength(0);

  const saving = deferred(), commit = deferred(), second = new AbortController(), save = deps.bookMemory.saveDigest;
  deps.bookMemory.saveDigest = async (id, digest, revision) => { saving.resolve(); await commit.promise; await save(id, digest, revision); };
  const dispatched = digestBookCatchUp({ deps, bookId: "b", model, signal: second.signal, complete: async () => reply() });
  await saving.promise; second.abort(); commit.resolve();
  await expect(dispatched).rejects.toBeDefined();
  expect(await deps.bookMemory.listDigests("b")).toHaveLength(1);
});

test("pre-cancel and invalid budgets do no IO; non-stop model responses never become digests", async () => {
  const { deps } = fixture(), controller = new AbortController(); controller.abort();
  deps.bookText.getToc = async () => { throw Error("Must not read"); };
  await expect(digestBookCatchUp({ deps, bookId: "b", model, signal: controller.signal, complete: async () => reply() })).rejects.toBeDefined();
  for (const concurrency of [0, -1, 1.5, 17, Infinity, NaN]) await expect(digestMissingChapters({ ...deps, bookId: "b", model, concurrency, beforeChapterIndex: 5, complete: async () => reply() })).rejects.toMatchObject({ code: "memory/invalid-input" });
  deps.library.getBook = async () => { throw Error("Must not read"); };
  await expect(digestBookTick({ deps, bookId: "b", model, maxChapters: -1, complete: async () => reply() })).rejects.toMatchObject({ code: "memory/invalid-input" });
  for (const stopReason of ["error", "aborted", "length", "toolUse"] as const) await expect(extractChapterDigest({ model, chapterIndex: 0, chapterText: "Text", knownCharacters: [], complete: async () => ({ ...reply(), stopReason }) })).rejects.toMatchObject({ code: "ai/provider" });
});

test("a zero chapter budget does not run automatic classification", async () => {
  const { deps, stores } = fixture(); stores.books[0]!.narrativity = undefined;
  expect(await digestBookTick({ deps, bookId: "b", model, maxChapters: 0, complete: async () => { throw Error("Must not infer"); } })).toMatchObject({ status: "partial", reason: "classification-pending", attempted: 0, remaining: 5 });
  expect(stores.books[0]!.narrativity).toBeUndefined();
});

test("classification changing during inference rejects old-flavor output without rebasing its revision", async () => {
  const { deps } = fixture();
  const report = await digestBookTick({ deps, bookId: "b", model, maxChapters: 1, complete: async () => {
    const before = (await deps.bookClassification.inspect("b"))!;
    await deps.bookClassification.change({ bookId: "b", narrativity: "expository", expectedRevision: before.revision });
    return reply();
  } });
  expect(report).toMatchObject({ status: "partial", digested: 0, remaining: 5, failures: [{ chapterIndex: 0, errorCode: "memory/conflict" }] });
  expect(await deps.bookMemory.listDigests("b")).toHaveLength(0);
});

test("two independently generated candidates cannot both replace the same chapter and unrelated writes remain independent", async () => {
  const { deps } = fixture(), started = deferred(), release = deferred(); let calls = 0;
  const run = () => digestMissingChapters({ ...deps, bookId: "b", beforeChapterIndex: 5, model, maxChapters: 1, complete: async () => { if (++calls === 2) started.resolve(); await release.promise; return reply(); } });
  const a = run(), b = run(); await started.promise; release.resolve();
  const results = await Promise.all([a,b]);
  expect(results.map(r => r.digested).sort()).toEqual([0,1]);
  expect(results.flatMap(r => r.failures)).toEqual([{ chapterIndex: 0, errorCode: "memory/conflict" }]);
  const snapshot = (await deps.bookMemory.inspectDigest("b", 0))!;
  const other = (await deps.bookMemory.inspectDigest("b", 1))!;
  const digest = { chapterIndex: 1, summary: "Other", characters: [], relations: [], digestVersion: 2 };
  await deps.bookMemory.saveDigest("b", digest, other.revision);
  expect((await deps.bookMemory.inspectDigest("b", 0))!.revision).toBe(snapshot.revision);
});
