import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { BookTextRepository, type TextSource } from "./book-text-repository";
import { parseBookTextRecord, type BookTextRecord } from "./book-text-record";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const prose = "A complete chapter with enough text for the existing chapter indexing policy.";
const makeBook = (readers: (() => Promise<string>)[]) => ({ sections: readers.map((getText, i) => ({ id: `s${i}`, getText })) } as FoliateBook);
function harness(book = makeBook([async () => prose])) {
  let source: TextSource = { format: "fb2", contentVersion: "sha256:a" };
  let exists = true, saved: unknown = null, parses = 0;
  let sourceError: unknown, writeError: unknown;
  let beforeWrite = async () => {};
  const warnings: unknown[] = [], sourceReads: boolean[] = [], signals: AbortSignal[] = [];
  const repo = new BookTextRepository({
    source: async (_id, fetch) => {
      sourceReads.push(fetch);
      if (sourceError) throw sourceError;
      if (!exists) throw new AppError("library/book-not-found", "gone");
      return { ...source };
    },
    read: async () => structuredClone(saved),
    write: async record => { await beforeWrite(); if (writeError) throw writeError; saved = structuredClone(record); },
    remove: async () => { saved = null; },
    content: async (_id, _version, signal, read) => { parses++; signals.push(signal); return read(book); },
    yieldToReader: async () => {}, warn: (_message, error) => { warnings.push(error); },
  });
  return { repo, warnings, sourceReads, signals, saved: () => saved, parses: () => parses,
    source: (value: TextSource) => { source = value; }, book: (value: FoliateBook) => { book = value; },
    exists: (value: boolean) => { exists = value; }, seed: (value: unknown) => { saved = value; },
    sourceError: (value?: unknown) => { sourceError = value; }, writeError: (value?: unknown) => { writeError = value; },
    beforeWrite: (value: () => Promise<void>) => { beforeWrite = value; } };
}

test("status reads never start extraction or fetch missing source; missing is not textless", async () => {
  const h = harness();
  expect((await h.repo.snapshot("book")).status).toBe("unprepared");
  h.source({ format: "pdf", contentVersion: null });
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "unavailable", text: "unknown" });
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "library/content-unavailable" });
  expect(h.parses()).toBe(0); expect(h.saved()).toBeNull();
  expect(h.sourceReads.slice(0, 2)).toEqual([false, false]);
  h.exists(false); await expect(h.repo.snapshot("book")).rejects.toMatchObject({ code: "library/book-not-found" });
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "library/book-not-found" });
});

test("cancelling one explicit request preserves another explicit or cold-reader lease", async () => {
  for (const keepReader of [false, true]) {
    const entered = deferred(), resume = deferred<string>(), joined = deferred();
    const h = harness(makeBook([async () => { entered.resolve(); return resume.promise; }]));
    h.source({ format: "pdf", contentVersion: "sha256:a" });
    const cancelled = new AbortController();
    const first = h.repo.prepare("book", { signal: cancelled.signal }).catch(error => error);
    await entered.promise;
    const second = keepReader ? h.repo.ensure("book") : h.repo.prepare("book", { progress: () => joined.resolve() });
    if (keepReader) await second; else await joined.promise;
    cancelled.abort(new AppError("library/text-cancelled", "cancelled only first"));
    expect(await first).toMatchObject({ code: "library/text-cancelled" });
    expect(h.signals[0]!.aborted).toBe(false); expect(h.parses()).toBe(1);
    resume.resolve(prose);
    await h.repo.prepare("book");
    if (!keepReader) expect(await second).toMatchObject({ status: "ready" });
    expect((await h.repo.snapshot("book")).status).toBe("ready");
  }
});

test("last consumer cancellation blocks late publication and permits a fresh request", async () => {
  const entered = deferred(), resume = deferred<string>();
  const h = harness(makeBook([async () => { entered.resolve(); return resume.promise; }]));
  const controller = new AbortController();
  const first = h.repo.prepare("book", { signal: controller.signal }).catch(error => error);
  await entered.promise; controller.abort(new AppError("library/text-cancelled", "cancel"));
  expect(await first).toMatchObject({ code: "library/text-cancelled" });
  expect(h.signals[0]!.aborted).toBe(true);
  h.book(makeBook([async () => prose + " fresh"]));
  await h.repo.prepare("book"); resume.resolve(prose + " stale");
  await Promise.resolve(); await Promise.resolve();
  expect((await h.repo.persisted("book"))![0]!.text).toContain("fresh");
});

test("rebuild rereads a complete index, rejects busy work, and cancelled preflight does not parse", async () => {
  const h = harness(); await h.repo.prepare("book");
  h.book(makeBook([async () => prose + " rebuilt"]));
  expect((await h.repo.ensure("book"))[0]!.text).not.toContain("rebuilt");
  expect(await h.repo.prepare("book", { rebuild: true })).toMatchObject({ status: "ready" });
  expect(h.parses()).toBe(2); expect((await h.repo.ensure("book"))[0]!.text).toContain("rebuilt");
  const entered = deferred(), resume = deferred<string>();
  h.book(makeBook([async () => { entered.resolve(); return resume.promise; }]));
  const busy = h.repo.prepare("book", { rebuild: true }); await entered.promise;
  await expect(h.repo.prepare("book", { rebuild: true })).rejects.toMatchObject({ code: "library/text-busy" });
  expect(await h.repo.persisted("book")).toBeNull(); resume.resolve(prose); await busy;
  const aborted = new AbortController(); aborted.abort(new AppError("library/text-cancelled", "cancel"));
  await expect(h.repo.prepare("book", { rebuild: true, signal: aborted.signal })).rejects.toMatchObject({ code: "library/text-cancelled" });
  expect(h.parses()).toBe(3);
});

test("successful empty reads alone prove textless; short text is not an image-only verdict", async () => {
  const empty = harness(makeBook([async () => " ", async () => ""]));
  expect(await empty.repo.ensure("book")).toEqual([]);
  expect(await empty.repo.snapshot("book")).toMatchObject({ status: "ready", text: "textless", progress: { total: 2, completed: 2, failed: 0 } });
  await empty.repo.ensure("book"); expect(empty.parses()).toBe(1);
  const short = harness(makeBook([async () => "短正文"]));
  expect(await short.repo.ensure("book")).toEqual([]);
  expect(await short.repo.snapshot("book")).toMatchObject({ status: "ready", text: "available", chapterCount: 0 });
});

test("failed sections are retained as failures and only successful pieces resume", async () => {
  let broken = true;
  const calls = [0, 0, 0];
  const h = harness(makeBook(calls.map((_, i) => async () => {
    calls[i]++;
    if (i === 1 && broken) throw new AppError("fs/permission", "no read");
    return prose;
  })));
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "fs/permission" });
  expect(await h.repo.persisted("book")).toBeNull();
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "partial", text: "available", chapterCount: 0, errorCode: "fs/permission",
    progress: { total: 3, completed: 2, failed: 1, unsupported: 0 } });
  broken = false;
  expect((await h.repo.ensure("book")).length).toBeGreaterThan(0);
  expect(calls).toEqual([1, 2, 1]);
  expect((await h.repo.snapshot("book")).status).toBe("ready");
  expect(h.warnings.length).toBe(2);
});

test("five consecutive failures stop work without losing earlier pieces or claiming unvisited sections", async () => {
  let broken = true;
  const calls = Array.from({ length: 65 }, () => 0);
  const h = harness(makeBook(calls.map((_, i) => async () => {
    calls[i]++; if (broken && i >= 27 && i < 32) throw Error("reader lost"); return prose;
  })));
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "library/text-extraction-failed" });
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "partial", progress: { completed: 27, failed: 5, total: 65 } });
  expect(calls[32]).toBe(0);
  broken = false; await h.repo.ensure("book");
  expect(calls.slice(0, 27).every(n => n === 1)).toBe(true);
  expect(calls.slice(27, 32).every(n => n === 2)).toBe(true);
  expect(calls.slice(32).every(n => n === 1)).toBe(true);
});

test("unsupported or absent linear sections cannot masquerade as successfully read blank sections", async () => {
  for (const book of [{ sections: [] }, { sections: [{ id: "unsupported" }] }, { sections: [{ linear: "no" }] }]) {
    const h = harness(book as FoliateBook);
    await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "library/text-unsupported" });
    expect(await h.repo.snapshot("book")).toMatchObject({ status: "unsupported", text: "unknown" });
  }
  const virtual = harness(); virtual.source({ format: "virtual", contentVersion: null });
  expect(await virtual.repo.snapshot("book")).toMatchObject({ status: "unsupported", text: "unknown" });
  expect(await virtual.repo.ensure("book")).toEqual([]); expect(virtual.parses()).toBe(0);
});

test("preparing persists until the exact durable write completes; read failures remain errors", async () => {
  const h = harness(); const entered = deferred(), save = deferred();
  h.beforeWrite(async () => { entered.resolve(); await save.promise; });
  const work = h.repo.ensure("book"); await entered.promise;
  expect((await h.repo.snapshot("book")).status).toBe("preparing");
  h.writeError(new AppError("db/locked", "busy")); save.resolve();
  await expect(work).rejects.toMatchObject({ code: "db/locked" });
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "error", errorCode: "db/locked" });
  expect(await h.repo.persisted("book")).toBeNull();
  h.writeError(); await h.repo.ensure("book"); expect((await h.repo.snapshot("book")).status).toBe("ready");
  h.sourceError(new AppError("db/locked", "busy")); await expect(h.repo.snapshot("book")).rejects.toMatchObject({ code: "db/locked" });
});

test("concurrent readers share extraction, and cold PDF queries see completed cache and background failures", async () => {
  const entered = deferred(), resume = deferred<string>();
  const h = harness(makeBook([async () => { entered.resolve(); return resume.promise; }]));
  h.source({ format: "pdf", contentVersion: "sha256:a" });
  expect(await h.repo.ensure("book")).toEqual([]); await entered.promise;
  const wait = h.repo.ensure("book", true);
  expect(await h.repo.ensure("book")).toEqual([]); expect(h.parses()).toBe(1);
  resume.resolve(prose); const chapters = await wait;
  expect(await h.repo.ensure("book")).toEqual(chapters); expect(h.parses()).toBe(1);
  const bad = harness(makeBook([async () => { throw Error("parse read"); }]));
  bad.source({ format: "pdf", contentVersion: "sha256:a" });
  await bad.repo.ensure("book");
  await expect(bad.repo.ensure("book", true)).rejects.toMatchObject({ code: "library/text-extraction-failed" });
  expect(await bad.repo.snapshot("book")).toMatchObject({ status: "partial", text: "unknown" });
});

test("a retry verifying a durable finalized record clears a previous in-process failure", async () => {
  const complete = harness(); await complete.repo.ensure("book");
  const h = harness(); h.writeError(new AppError("db/locked", "write acknowledgement failed"));
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "db/locked" });
  h.seed(complete.saved());
  expect((await h.repo.snapshot("book")).status).toBe("error");
  await h.repo.ensure("book");
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "ready", text: "available" });
  expect((await h.repo.snapshot("book")).errorCode).toBeUndefined();
  expect(h.parses()).toBe(1);
});

test("a last-section checkpoint is not a finalized index, including after repository restart", async () => {
  const calls = Array.from({ length: 25 }, () => 0);
  const book = makeBook(calls.map((_, i) => async () => { calls[i]++; return prose; }));
  const h = harness(book);
  let writes = 0;
  h.beforeWrite(async () => { if (++writes === 2) throw new AppError("db/locked", "final index write failed"); });
  await expect(h.repo.ensure("book")).rejects.toMatchObject({ code: "db/locked" });
  expect(h.saved()).toMatchObject({ finalized: false, chapters: [] });
  expect(await h.repo.persisted("book")).toBeNull();
  expect(await h.repo.snapshot("book")).toMatchObject({ status: "partial", progress: { total: 25, completed: 25 } });
  const restarted = harness(book); restarted.seed(h.saved());
  expect((await restarted.repo.snapshot("book")).status).toBe("partial");
  expect((await restarted.repo.ensure("book")).length).toBeGreaterThan(0);
  expect(calls.every(n => n === 1)).toBe(true);
  expect(await restarted.repo.snapshot("book")).toMatchObject({ status: "ready", text: "available" });
});

test("source changes invalidate old in-flight results and completed caches", async () => {
  const entered = deferred(), resume = deferred<string>();
  const h = harness(makeBook([async () => { entered.resolve(); return resume.promise; }]));
  const old = h.repo.ensure("book").catch(error => error); await entered.promise;
  h.source({ format: "fb2", contentVersion: "sha256:b" }); h.book(makeBook([async () => prose + " new"]));
  const fresh = await h.repo.ensure("book"); resume.resolve(prose + " old");
  expect(await old).toMatchObject({ code: "reader/stale-location" });
  expect(await h.repo.persisted("book")).toEqual(fresh);
  h.source({ format: "fb2", contentVersion: "sha256:c" });
  expect((await h.repo.snapshot("book")).status).toBe("unprepared"); expect(await h.repo.persisted("book")).toBeNull();
});

test("deletion while a section or write is pending cannot resurrect a derived record", async () => {
  for (const stage of ["read", "write"]) {
    const entered = deferred(), resume = deferred();
    const h = harness(makeBook([async () => { if (stage === "read") { entered.resolve(); await resume.promise; } return prose; }]));
    if (stage === "write") h.beforeWrite(async () => { entered.resolve(); await resume.promise; });
    const work = h.repo.ensure("book").catch(error => error); await entered.promise;
    h.exists(false); const remove = h.repo.remove("book"); resume.resolve(); await remove;
    expect(await work).toMatchObject({ code: "library/book-not-found" }); expect(h.saved()).toBeNull();
  }
});

test("legacy, wrong-source and structurally corrupt records are never trusted as terminal", async () => {
  const h = harness(); await h.repo.ensure("book"); const good = h.saved() as BookTextRecord;
  expect(parseBookTextRecord(good, "book", "sha256:a")).not.toBeNull();
  for (const value of [null, [], { version: 4, complete: true, chapters: [] }, { ...good, contentVersion: "sha256:old" },
    { ...good, required: [0, 0] }, { ...good, pieces: [...good.pieces, ...good.pieces] }, { ...good, failures: [{ sectionIndex: 0, code: "db/error" }] },
    { ...good, chapters: [{ text: 23 }] }, { ...good, pieces: [{ sectionIndex: 4, text: "x" }] },
    { ...good, finalized: undefined }, { ...good, finalized: false }, { ...good, pieces: [] }]) {
    h.seed(value); expect((await h.repo.snapshot("book")).status).toBe("unprepared"); expect(await h.repo.persisted("book")).toBeNull();
  }
});
