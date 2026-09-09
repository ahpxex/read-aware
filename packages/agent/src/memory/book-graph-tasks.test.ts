import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError, type DigestReport } from "@read-aware/core";
import { BookGraphTaskOwner, type BookGraphTaskExecution } from "./book-graph-tasks";
import { createInMemoryDeps } from "../testing/fixtures";
import { digestBookCatchUp, type DigestBookTickInput } from "./graph-upkeep";
import { runMemoryBuild } from "./build-policy";

const empty: DigestReport = { status: "complete", eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };
const next = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function done(owner: BookGraphTaskOwner, id: string) {
  for (let i = 0; i < 100; i++) { const task = await owner.get("b", id); if (!["queued", "running", "cancelling"].includes(task.status)) return task; await next(); }
  throw Error("Task did not settle");
}

test("handles isolate owners/books, cancellation waits for execution, and terminal snapshots cannot be mutated", async () => {
  const gate = deferred(); let execution!: BookGraphTaskExecution;
  const owner = new BookGraphTaskOwner(async input => { execution = input; input.onStarted(); await gate.promise; return empty; }, () => {});
  const task = await owner.start("b", "catch-up");
  expect(task.status).toBe("queued"); expect((await owner.get("b", task.taskId)).status).toBe("running");
  await expect(owner.get("other", task.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  await expect(new BookGraphTaskOwner(async () => empty, () => {}).get("b", task.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  expect((await owner.cancel("b", task.taskId)).status).toBe("cancelling"); expect(execution.signal.aborted).toBe(true);
  await expect(owner.retry("b", task.taskId)).rejects.toMatchObject({ code: "memory/conflict" });
  gate.resolve(); const final = await done(owner, task.taskId); expect(final.status).toBe("cancelled");
  final.status = "completed"; expect((await owner.cancel("b", task.taskId)).status).toBe("cancelled");
  const terminal = await owner.get("b", task.taskId);
  execution.onStarted(); execution.onReport({ ...empty, digested: 999 });
  expect(await owner.get("b", task.taskId)).toEqual(terminal);
});

test("actor capacity, terminal eviction and generation retirement are bounded", async () => {
  const gate = deferred(), life = new AbortController(), signals: AbortSignal[] = [];
  const owner = new BookGraphTaskOwner(async input => { signals.push(input.signal); await gate.promise; return empty; }, () => {}, life.signal);
  const tasks = await Promise.all(Array.from({ length: 16 }, () => owner.start("b", "catch-up")));
  await expect(owner.start("b", "catch-up")).rejects.toMatchObject({ code: "memory/task-limit" });
  gate.resolve(); await done(owner, tasks[0]!.taskId);
  for (let i = 0; i < 65; i++) { const task = await owner.start("b", "catch-up"); await done(owner, task.taskId); }
  expect(await owner.list("b")).toHaveLength(64);
  await expect(owner.get("b", tasks[0]!.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  life.abort(); await expect(owner.list("b")).rejects.toMatchObject({ code: "memory/cancelled" });
  const pendingGate = deferred(), retired = new AbortController(); let signal!: AbortSignal;
  const active = new BookGraphTaskOwner(async input => { signal = input.signal; await pendingGate.promise; return empty; }, () => {}, retired.signal);
  await active.start("b", "rebuild"); retired.abort(); expect(signal.aborted).toBe(true); pendingGate.resolve(); await next();
});

test("late execution callbacks cannot alter a terminal retry plan or retained report", async () => {
  let execution!: BookGraphTaskExecution;
  const report: DigestReport = { ...empty, status: "partial", remaining: 1, failures: [] };
  const owner = new BookGraphTaskOwner(async input => {
    execution = input;
    input.onPlan(input.targets ? [...input.targets] : [0, 1]);
    input.onChapterCommitted(1);
    return report;
  }, () => {});
  const first = await done(owner, (await owner.start("b", "rebuild")).taskId);
  execution.onPlan([2]); execution.onChapterCommitted(0);
  report.remaining = 999; report.failures.push({ chapterIndex: 9, errorCode: "ai/provider" });
  expect(await owner.get("b", first.taskId)).toEqual(first);
  await owner.retry("b", first.taskId);
  expect(execution.targets).toEqual([0]);
});

test("failed rebuild keeps old digests and retry targets only failed rebuild chapters", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative" }],
    chapters: { b: [0, 1].map(index => ({ title: `C${index}`, text: `Text${index}`, hrefs: [String(index)] })) } });
  const model = { id: "fixture" } as DigestBookTickInput["model"];
  const reply = (summary: string) => fauxAssistantMessage(JSON.stringify({ summary, characters: [], relations: [] }));
  await digestBookCatchUp({ deps, bookId: "b", model, complete: async () => reply("Old") });
  let calls = 0;
  const owner = new BookGraphTaskOwner(input => runMemoryBuild(deps, operation => digestBookCatchUp({
    ...input, deps: operation.protect(deps), model, signal: operation.signal,
    complete: operation.complete(async () => { if (++calls === 1) throw new AppError("ai/provider", "failure"); return reply("New"); }),
  }), input.signal), () => {});
  const first = await done(owner, (await owner.start("b", "rebuild")).taskId);
  expect(first).toMatchObject({ status: "partial", report: { attempted: 2, digested: 1, remaining: 1, failures: [{ chapterIndex: 0, errorCode: "ai/provider" }] } });
  expect((await deps.bookMemory.listDigests("b")).map(row => row.summary)).toEqual(["Old", "New"]);
  const retry = await done(owner, (await owner.retry("b", first.taskId)).taskId);
  expect(retry).toMatchObject({ status: "completed", retryOf: first.taskId, report: { attempted: 1, digested: 1 } });
  expect(calls).toBe(3); expect((await deps.bookMemory.listDigests("b")).map(row => row.summary)).toEqual(["New", "New"]);
  await expect(owner.retry("b", retry.taskId)).rejects.toMatchObject({ code: "memory/conflict" });
});

test("public boundary is resolved after queueing and rechecked before a generated chapter writes", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative" }], chapters: { b: [{ title: "C", text: "Text", hrefs: ["0"] }] } });
  const model = { id: "fixture" } as DigestBookTickInput["model"], gate = deferred(); let ceiling: number | undefined = 1, calls = 0;
  const busy = deps.bookMemory.runExclusive("b", () => gate.promise);
  const run = () => digestBookCatchUp({ deps, bookId: "b", model, resolveBoundary: async () => ceiling,
    checkChapter: async index => { if (ceiling === undefined || index >= ceiling) throw new AppError("memory/conflict", "boundary"); },
    complete: async () => { calls++; ceiling = 0; return fauxAssistantMessage('{"summary":"Late","characters":[],"relations":[]}'); } });
  const queued = run(); ceiling = undefined; gate.resolve(); await busy;
  expect(await queued).toMatchObject({ status: "unavailable", reason: "boundary-unknown" }); expect(calls).toBe(0);
  ceiling = 1; expect(await run()).toMatchObject({ status: "partial", digested: 0, failures: [{ chapterIndex: 0, errorCode: "memory/conflict" }] });
  expect(await deps.bookMemory.listDigests("b")).toHaveLength(0);
});
