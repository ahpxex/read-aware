import { expect, test } from "bun:test";
import { AppError, type ReadingEmphasisSnapshot } from "@read-aware/core";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadingEmphasisController, type ReadingEmphasisAdapter, type EmphasisPresentation } from "./reading-emphasis-controller";

const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(deadline = 1000) {
  const reading = new ReadingSessionController(), errors: unknown[] = [], drawings = new Map<string, unknown>();
  const sessionId = reading.begin("book");
  reading.attach(sessionId, { navigate: async () => range, step: async () => range }, range);
  let feedback!: (id: string, state: EmphasisPresentation) => void;
  const adapter: ReadingEmphasisAdapter = {
    validate: async () => {}, put: (id, ranges, style) => { drawings.set(id, { ranges, style }); return { attached: ranges.length, status: "attached" }; },
    remove: id => { drawings.delete(id); },
    observe: handler => { feedback = handler; return () => {}; }, retire: () => { drawings.clear(); },
  };
  const controller = new ReadingEmphasisController(reading, error => errors.push(error), deadline);
  const release = controller.bind(sessionId, "book", "v1", adapter);
  return { reading, controller, adapter, drawings, release, errors, feedback: (id: string, state: EmphasisPresentation) => feedback(id, state) };
}

test("owned batches validate before commit, copy inputs, never navigate, and remove only their own revision", async () => {
  const f = fixture(), a = f.controller.forOwner({}), b = f.controller.forOwner({});
  const before = f.reading.snapshot(), input = { ranges: [structuredClone(range)] };
  let done!: () => void;
  f.adapter.validate = () => new Promise(resolve => { done = resolve; });
  const pending = a.put(input); input.ranges[0].cfi = "mutated";
  expect(a.list()).toEqual([]); expect(f.drawings.size).toBe(0);
  done(); const first = (await pending).emphasis;
  expect(f.drawings.get(first.id)).toMatchObject({ ranges: [range] });
  expect(f.reading.snapshot()).toEqual(before); expect(b.list()).toEqual([]);
  expect(await b.remove({ id: first.id, expectedRevision: first.revision })).toMatchObject({ removed: false });
  f.adapter.validate = async () => {};
  const second = (await a.put({ ranges: [range], id: first.id, expectedRevision: first.revision, style: "underline" })).emphasis;
  await expect(a.remove({ id: first.id, expectedRevision: first.revision })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(await a.remove({ id: second.id, expectedRevision: second.revision })).toMatchObject({ removed: true });
  expect(await a.remove({ id: second.id, expectedRevision: second.revision })).toMatchObject({ removed: false });
  expect(f.drawings.size).toBe(0); f.release();
});

test("source failures and renderer failures preserve the previous committed group", async () => {
  const f = fixture(), a = f.controller.forOwner({});
  const first = (await a.put({ ranges: [range] })).emphasis;
  for (const phase of ["validate", "put"] as const) {
    const original = f.adapter[phase];
    f.adapter[phase] = () => { throw new AppError("reader/target-not-found", "Invalid range"); };
    await expect(a.put({ ranges: [range], id: first.id, expectedRevision: first.revision })).rejects.toMatchObject({ code: "reader/target-not-found" });
    expect(a.list()).toEqual([first]); expect(f.drawings.size).toBe(1);
    Object.assign(f.adapter, { [phase]: original });
  }
  f.release();
});

test("cancel, deadline, owner retirement and renderer replacement reject promptly while tracking physical drain", async () => {
  for (const action of ["abort", "timeout", "retire", "close", "replace"] as const) {
    const f = fixture(action === "timeout" ? 5 : 1000), lifetime = new AbortController(), caller = new AbortController();
    const cleanups: Promise<void>[] = [], a = f.controller.forOwner({}, lifetime.signal, work => cleanups.push(work));
    let finish!: () => void;
    f.adapter.validate = () => new Promise(resolve => { finish = resolve; });
    const pending = a.put({ ranges: [range] }, caller.signal).catch(error => error);
    if (action === "abort") caller.abort(Error("cancelled"));
    if (action === "retire") lifetime.abort(Error("retired"));
    if (action === "close") f.reading.closed();
    const release = action === "replace" ? f.controller.bind(f.reading.snapshot().sessionId!, "book", "v1", { ...f.adapter }) : undefined;
    const error = await pending;
    expect(error).toBeInstanceOf(Error); expect(f.drawings.size).toBe(0);
    expect(cleanups).toHaveLength(1); let drained = false; void cleanups[0].then(() => { drained = true; });
    await tick(); expect(drained).toBe(false);
    finish(); await cleanups[0]; expect(drained).toBe(true); expect(f.drawings.size).toBe(0);
    release?.(); f.release();
  }
});

test("presentation observation is isolated and does not change the configuration revision", async () => {
  const f = fixture(), owner = {}, a = f.controller.forOwner(owner), b = f.controller.forOwner({});
  const seen: ReadingEmphasisSnapshot[][] = [], other: ReadingEmphasisSnapshot[][] = [];
  const off = a.observe(values => { seen.push(values); if (values[0]) values[0].count = 999; });
  const offOther = b.observe(values => other.push(values));
  const first = (await a.put({ ranges: [range] })).emphasis;
  f.feedback(first.id, { attached: 0, status: "deferred" });
  expect(a.list()[0]).toMatchObject({ count: 1, revision: first.revision, attached: 0, status: "deferred" });
  expect(other).toEqual([[]]); expect(seen).toHaveLength(3);
  f.reading.closed(); expect(a.list()).toEqual([]); expect(seen.at(-1)).toEqual([]);
  off(); offOther(); f.release();
});

test("strict bounds, scope and revisions reject without renderer mutation", async () => {
  const f = fixture(), a = f.controller.forOwner({});
  for (const input of [{ ranges: [] }, { ranges: Array(65).fill(range) }, { ranges: [range], id: "foreign" },
    { ranges: [range], style: "url(secret)" }, { ranges: [range], owner: "agent" }, { ranges: [range, { ...range, bookId: "other" }] }]) {
    await expect(a.put(input as never)).rejects.toMatchObject({ code: "reader/invalid-target" });
  }
  await expect(a.put({ ranges: [{ ...range, bookId: "other" }] })).rejects.toMatchObject({ code: "reader/out-of-scope" });
  await expect(a.put({ ranges: [{ ...range, contentVersion: "old" }] })).rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(a.put({ ranges: [range] }, undefined, { sessionId: "stale" })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(f.drawings.size).toBe(0);
  for (let index = 0; index < 16; index++) await a.put({ ranges: [range] });
  await expect(a.put({ ranges: [range] })).rejects.toMatchObject({ code: "reader/unavailable" });
  f.release();
});

test("new updates and removes supersede slow validation without affecting other owned groups", async () => {
  const f = fixture(), a = f.controller.forOwner({});
  const first = (await a.put({ ranges: [range] })).emphasis;
  let release!: () => void;
  f.adapter.validate = () => new Promise(resolve => { release = resolve; });
  const pending = a.put({ ranges: [range], id: first.id, expectedRevision: first.revision }).catch(error => error);
  await a.remove({ id: first.id, expectedRevision: first.revision });
  expect(await pending).toMatchObject({ code: "reader/superseded" });
  release(); await tick(); expect(f.drawings.size).toBe(0); f.release();
});

test("a newer update wins and unexpected late source failure remains a failed cleanup", async () => {
  const f = fixture(), cleanups: Promise<void>[] = [], a = f.controller.forOwner({}, undefined, work => cleanups.push(work));
  const first = (await a.put({ ranges: [range] })).emphasis;
  let fail!: (error: unknown) => void;
  f.adapter.validate = () => new Promise((_, reject) => { fail = reject; });
  const old = a.put({ ranges: [range], id: first.id, expectedRevision: first.revision }).catch(error => error);
  f.adapter.validate = async () => {};
  const next = await a.put({ ranges: [range], id: first.id, expectedRevision: first.revision, style: "underline" });
  expect(await old).toMatchObject({ code: "reader/superseded" });
  const error = Error("late native read failure"); fail(error);
  await expect(cleanups[1]).rejects.toBe(error);
  expect(f.errors).toContain(error); expect(a.list()).toEqual([next.emphasis]); f.release();
});
