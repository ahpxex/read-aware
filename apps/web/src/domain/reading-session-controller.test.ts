import { expect, test } from "bun:test";
import { AppError, type ReadingLocation } from "@read-aware/core";
import { ReadingSessionController, type ReadingEngineAdapter } from "./reading-session-controller";

const at = (cfi: string, bookId = "book"): ReadingLocation => ({ bookId, contentVersion: "sha256:fixture", cfi });
function fixture(deadline = 1000) {
  const errors: unknown[] = [];
  const runtime = new ReadingSessionController(error => errors.push(error), deadline);
  const id = runtime.begin("book");
  const engine: ReadingEngineAdapter = {
    navigate: async target => {
      if (target.cfi === "missing") throw new AppError("reader/target-not-found", "Missing location");
      return at(target.cfi ?? "fraction");
    },
    step: async direction => at(direction),
  };
  const detach = runtime.attach(id, engine, at("start"));
  return { runtime, id, engine, detach, errors };
}

test("snapshot plus subscription starts at the current revision and isolates failing observers", async () => {
  const f = fixture(); const seen: number[] = [];
  const off = f.runtime.observe(state => { seen.push(state.revision); state.location!.cfi = "mutated"; });
  f.runtime.observe(async () => { throw new Error("observer failed"); });
  await Promise.resolve();
  expect(f.errors).toHaveLength(1); expect(f.runtime.snapshot().location?.cfi).toBe("start");
  f.runtime.relocate(f.id, at("page"), "visible"); expect(seen).toHaveLength(2);
  expect(seen[1]).toBeGreaterThan(seen[0]); off();
  f.runtime.relocate("stale-id", at("stale"), "stale"); expect(f.runtime.snapshot().visibleText).toBe("visible");
});

test("completion waits for the renderer and failures never create a history entry", async () => {
  const f = fixture(); let finish!: (location: ReadingLocation) => void;
  f.engine.navigate = () => new Promise(resolve => { finish = resolve; });
  let completed = false;
  const pending = f.runtime.navigate({ cfi: "target" }).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(completed).toBe(false);
  finish(at("actual")); expect((await pending).location.cfi).toBe("actual");
  f.engine.navigate = async () => { throw new Error("engine failed"); };
  await expect(f.runtime.navigate({ cfi: "missing" })).rejects.toThrow("engine failed");
  expect(f.runtime.snapshot().location?.cfi).toBe("actual");
});

test("back and forward traverse without branching; a new jump discards forward history", async () => {
  const { runtime } = fixture();
  await runtime.navigate({ cfi: "middle" }); await runtime.navigate({ cfi: "end" });
  expect((await runtime.back()).location.cfi).toBe("middle");
  expect((await runtime.back()).location.cfi).toBe("start");
  expect((await runtime.forward()).location.cfi).toBe("middle");
  await runtime.navigate({ cfi: "branch" });
  expect(runtime.snapshot().history.canGoForward).toBe(false);
  expect((await runtime.back()).location.cfi).toBe("middle");
});

test("a stale content version and out-of-range fraction fail before engine movement", async () => {
  const f = fixture(); let moved = false; f.engine.navigate = async () => { moved = true; return at("bad"); };
  await expect(f.runtime.navigate({ contentVersion: "old", cfi: "somewhere" })).rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(f.runtime.navigate({ fraction: 1.1 })).rejects.toMatchObject({ code: "reader/invalid-target" });
  expect(moved).toBe(false);
});

test("closing and a newer user open invalidate late results and stale engine cleanup", async () => {
  const f = fixture(); let finish!: (location: ReadingLocation) => void;
  f.engine.navigate = () => new Promise(resolve => { finish = resolve; });
  const old = f.runtime.navigate({ cfi: "old" }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  const nextId = f.runtime.begin("next");
  f.runtime.attach(nextId, { navigate: async () => at("next", "next"), step: async () => at("next", "next") }, at("next", "next"));
  f.detach(); finish(at("old"));
  expect(await old).toMatchObject({ code: "reader/superseded" });
  expect(f.runtime.snapshot()).toMatchObject({ bookId: "next", status: "ready" });
  f.runtime.closed(); expect(f.runtime.snapshot().status).toBe("idle");
});

test("opening waits for readiness and propagates load failure rather than opened:true", async () => {
  const runtime = new ReadingSessionController();
  runtime.bindShell({ open: (bookId, intent) => { const id = runtime.begin(bookId, intent); runtime.fail(id, new AppError("fs/not-found", "Source missing")); }, close: () => runtime.closed() });
  await expect(runtime.navigate({ bookId: "missing" })).rejects.toMatchObject({ code: "fs/not-found" });
  expect(runtime.snapshot().history.canGoBack).toBe(false);
});

test("cancellation settles promptly and a late renderer completion cannot publish success", async () => {
  const f = fixture(); let finish!: (location: ReadingLocation) => void;
  f.engine.navigate = () => new Promise(resolve => { finish = resolve; });
  const abort = new AbortController();
  const pending = f.runtime.navigate({ cfi: "late" }, abort.signal).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0)); abort.abort(new Error("cancelled"));
  expect(await pending).toMatchObject({ message: "cancelled" });
  finish(at("late")); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.runtime.snapshot().location?.cfi).toBe("start");
});

test("a deadline cannot later mutate history or strand readiness subscriptions", async () => {
  const f = fixture(5); let finish!: (location: ReadingLocation) => void;
  f.engine.navigate = () => new Promise(resolve => { finish = resolve; });
  expect(await f.runtime.navigate({ cfi: "late" }).catch(error => error)).toMatchObject({ code: "reader/timeout" });
  finish(at("late")); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.runtime.snapshot().history.canGoBack).toBe(false);
});

test("close resolves after the host actually clears its session", async () => {
  const { runtime } = fixture(); let close!: () => void;
  runtime.bindShell({ open() {}, close: () => { close = () => runtime.closed(); } });
  let completed = false;
  const pending = runtime.close().then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false);
  close(); await pending; expect(completed).toBe(true);
});

test("a superseding book request does not wait for the old book's readiness timeout", async () => {
  const runtime = new ReadingSessionController();
  runtime.bindShell({ open: (bookId, intent) => {
    const id = runtime.begin(bookId, intent);
    if (bookId === "new") runtime.attach(id, { navigate: async () => at("new", "new"), step: async () => at("new", "new") }, at("new", "new"));
  }, close: () => runtime.closed() });
  const first = runtime.navigate({ bookId: "old" }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = runtime.navigate({ bookId: "new" });
  expect(await first).toMatchObject({ code: "reader/superseded" });
  expect((await second).location.bookId).toBe("new");
});

test("book-scoped history cannot navigate into another book", async () => {
  const { runtime } = fixture();
  const id = runtime.begin("other");
  runtime.attach(id, { navigate: async () => at("other", "other"), step: async () => at("other", "other") }, at("other", "other"));
  await expect(runtime.back(undefined, { bookId: "other", sessionId: id })).rejects.toMatchObject({ code: "reader/out-of-scope" });
  expect(runtime.snapshot().bookId).toBe("other");
  expect(runtime.snapshot().history.canGoBack).toBe(true);
});

test("stale session guards cannot close or turn a replacement reader", async () => {
  const { runtime, id } = fixture();
  runtime.bindShell({ open() {}, close: () => { throw new Error("must not close"); } });
  const current = runtime.begin("book");
  let steps = 0;
  runtime.attach(current, { navigate: async () => at("new"), step: async () => { steps++; return at("new"); } }, at("new"));
  await expect(runtime.close(undefined, { sessionId: id })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(runtime.step("next", undefined, { sessionId: id })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(steps).toBe(0);
});

test("locations sharing an href but not a fraction retain distinct history entries", async () => {
  const runtime = new ReadingSessionController();
  const id = runtime.begin("book");
  const location = (fraction: number): ReadingLocation => ({ bookId: "book", contentVersion: "v1", href: "chapter", fraction });
  runtime.attach(id, { navigate: async target => location(target.fraction!), step: async () => location(0.5) }, location(0));
  await runtime.navigate({ fraction: 0.5 });
  expect(runtime.snapshot().history.canGoBack).toBe(true);
  expect((await runtime.back()).location.fraction).toBe(0);
});

test("an old renderer's pending movement cannot block a different book", async () => {
  const { runtime, engine } = fixture();
  let finish!: (location: ReadingLocation) => void;
  engine.navigate = () => new Promise(resolve => { finish = resolve; });
  const old = runtime.navigate({ cfi: "old" }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  runtime.bindShell({ open(bookId, intent) {
    const id = runtime.begin(bookId, intent);
    runtime.attach(id, { navigate: async () => at("new", bookId), step: async () => at("new", bookId) }, at("new", bookId));
  }, close() {} });
  expect((await runtime.navigate({ bookId: "new" })).location.bookId).toBe("new");
  finish(at("old"));
  expect(await old).toMatchObject({ code: "reader/superseded" });
  expect(runtime.snapshot().bookId).toBe("new");
});

test("a recovered engine clears the previous load error", async () => {
  const { runtime, id, engine } = fixture();
  runtime.fail(id, new AppError("reader/load-failed", "First attempt failed"));
  runtime.attach(id, engine, at("recovered"));
  expect(runtime.snapshot().errorCode).toBeUndefined();
  expect((await runtime.navigate({ cfi: "next" })).location.cfi).toBe("next");
});
