import { expect, test } from "bun:test";
import { AppError, type ReaderPanelsView } from "@read-aware/core";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReaderPanelsService } from "./reader-panels";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const initial = (): ReaderPanelsView => ({ controlsVisible: false, sizes: { toc: 288, chat: 352 }, layout: "docked", panels: {
  toc: { open: false, visible: false }, chat: { open: false, visible: false },
  annotations: { open: false, visible: false }, appearance: { open: false, visible: false },
} });
function fixture(deadline = 1000) {
  const errors: unknown[] = [];
  const reading = new ReadingSessionController(error => errors.push(error));
  const service = new ReaderPanelsService(reading, error => errors.push(error), deadline);
  const id = reading.begin("book"), at = { bookId: "book", contentVersion: "v1", cfi: "at" };
  const detach = reading.attach(id, { navigate: async () => at, step: async () => at }, at);
  let view = initial(), token = 0, held = false;
  let commitWrite!: () => void, rejectWrite!: (error: unknown) => void;
  let applyCount = 0, signal: AbortSignal | undefined;
  reading.bindControls(id, { snapshot: () => ({ visible: view.controlsVisible }), observe: () => () => {},
    setVisible: async visible => { view.controlsVisible = visible; return { visible }; }, retire() {} });
  const binding = service.bind(id, "book", {
    applyWidth: async (panel, width, passed) => {
      applyCount++; signal = passed;
      if (held) await new Promise<void>((resolve, reject) => { commitWrite = resolve; rejectWrite = reject; });
      passed.throwIfAborted(); view.sizes[panel] = width;
    },
    apply: async (panel, open, passed) => {
      applyCount++; signal = passed;
      if (held) await new Promise<void>((resolve, reject) => { commitWrite = resolve; rejectWrite = reject; });
      passed.throwIfAborted(); view.panels[panel] = { open, visible: open && view.controlsVisible };
    }, requestCommit: value => { token = value; },
  }, view);
  return { reading, service, id, errors, binding, detach,
    get view() { return view; }, get token() { return token; }, get applyCount() { return applyCount; }, get signal() { return signal; },
    hold: () => { held = true; }, release: () => { held = false; commitWrite(); }, reject: (e: unknown) => { held = false; rejectWrite(e); },
    commit: (value = token) => binding.publish(view, value),
  };
}

test("panel receipt waits for durable apply and a matching fresh DOM commit", async () => {
  const f = fixture(); f.hold(); let settled = false;
  const before = f.reading.snapshot();
  const promise = f.service.setPanel("toc", true).then(v => { settled = true; return v; });
  await tick(); f.commit(); expect(settled).toBe(false); expect(f.token).toBe(0);
  f.release(); await tick(); expect(settled).toBe(false); expect(f.token).toBe(1);
  f.commit(0); await tick(); expect(settled).toBe(false);
  f.commit(); expect(await promise).toMatchObject({ status: "completed", panel: "toc", snapshot: { sessionId: f.id, panels: { toc: { open: true, visible: true } } } });
  expect(f.reading.snapshot()).toEqual(before);
  f.binding.dispose();
});
test("width changes share session arbitration and await persistence and commit without opening panels", async () => {
  const f = fixture(); f.hold(); let settled = false;
  const request = f.service.setWidth("toc", 420).then(result => { settled = true; return result; });
  await tick(); f.commit(); expect(settled).toBe(false);
  f.release(); await tick(); expect(settled).toBe(false);
  f.commit(); expect((await request).snapshot).toMatchObject({ sizes: { toc: 420, chat: 352 }, controlsVisible: false, panels: { toc: { open: false } } });
  for (const width of [NaN, Infinity, 239, 641, 300.5]) await expect(f.service.setWidth("chat", width)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(f.service.setWidth("appearance" as "toc", 300)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(f.service.setWidth("toc", 300, undefined, { sessionId: "old" })).rejects.toMatchObject({ code: "reader/superseded" });
  f.hold(); const failed = f.service.setWidth("chat", 400).catch(error => error);
  await tick(); f.reject(new AppError("db/locked", "private"));
  expect(await failed).toMatchObject({ code: "db/locked" });
  expect(f.service.snapshot()?.sizes.chat).toBe(352);
  f.binding.dispose();
});
test("same-value close still requires a new UI commit and does not reveal chrome", async () => {
  const f = fixture(); const promise = f.service.setPanel("chat", false); await tick();
  expect(f.service.snapshot()?.controlsVisible).toBe(false); f.commit();
  expect((await promise).snapshot.panels.chat).toEqual({ open: false, visible: false }); f.binding.dispose();
});
test("invalid inputs, stale guards and pre-abort do not dispatch", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(f.service.setPanel("toc", true, abort.signal)).rejects.toThrow("cancelled");
  await expect(f.service.setPanel("bad" as "toc", true)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(f.service.setPanel("toc", "true" as unknown as boolean)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(f.service.setPanel("toc", true, undefined, { sessionId: "old" })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(f.service.setPanel("toc", true, undefined, { bookId: "other" })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(f.service.setPanel("toc", true, undefined, null as never)).rejects.toMatchObject({ code: "reader/invalid-target" });
  expect(f.applyCount).toBe(0); f.binding.dispose();
});
test("native persistence failure retains the exact error and permits retry", async () => {
  const f = fixture(); f.hold(); const error = new AppError("db/locked", "private");
  const failed = f.service.setPanel("toc", true).catch(e => e); await tick(); f.reject(error);
  expect(await failed).toBe(error); expect(f.token).toBe(0);
  const retry = f.service.setPanel("toc", true); await tick(); f.commit(); await retry; f.binding.dispose();
});
test("new intent aborts old work; late completion cannot request a render or acknowledge the replacement", async () => {
  const f = fixture(); f.hold(); const old = f.service.setPanel("toc", true).catch(e => e); await tick();
  const oldSignal = f.signal; f.release();
  const next = f.service.setPanel("chat", true); expect(await old).toMatchObject({ code: "reader/superseded" });
  expect(oldSignal?.aborted).toBe(true); await tick(); expect(f.token).toBe(2); f.commit();
  expect((await next).panel).toBe("chat"); expect(f.view.panels.toc.open).toBe(false); f.binding.dispose();
});
test("cancellation and deadline settle immediately and prevent late work acknowledgement", async () => {
  for (const cancel of [true, false]) {
    const f = fixture(cancel ? 1000 : 5); f.hold(); const abort = new AbortController();
    const request = f.service.setPanel("appearance", true, abort.signal).catch(e => e); await tick();
    if (cancel) abort.abort(new Error("cancelled"));
    expect(await request).toMatchObject(cancel ? { message: "cancelled" } : { code: "reader/timeout" });
    expect(f.signal?.aborted).toBe(true); f.release(); await tick(); expect(f.token).toBe(0); f.binding.dispose();
  }
});
test("close, loading, failure, replacement and owner removal cancel and invalidate the snapshot", async () => {
  for (const end of ["close", "loading", "failure", "replace", "unbind"]) {
    const f = fixture(); f.hold(); const request = f.service.setPanel("toc", true).catch(e => e); await tick();
    if (end === "close") f.reading.closed();
    if (end === "loading") f.detach();
    if (end === "failure") f.reading.fail(f.id, new Error("failed"));
    if (end === "replace") f.reading.begin("book");
    if (end === "unbind") f.binding.dispose();
    expect(await request).toMatchObject({ code: "reader/superseded" }); expect(f.service.snapshot()).toBeNull();
    f.release(); await tick(); f.commit(); expect(f.service.snapshot()).toBeNull(); f.binding.dispose();
  }
});
test("hiding chrome and conflicting committed state supersede pending presentation", async () => {
  for (const hide of [true, false]) {
    const f = fixture(); const request = f.service.setPanel("chat", true).catch(e => e); await tick();
    f.binding.publish({ ...f.view, controlsVisible: true }, 0);
    if (hide) f.view.controlsVisible = false;
    else f.view.panels.chat = { open: false, visible: false };
    f.commit(); expect(await request).toMatchObject({ code: "reader/superseded" }); f.binding.dispose();
  }
});
test("observers get cloned snapshots, isolate errors and cannot rewrite a completed receipt", async () => {
  const f = fixture(); let changed = false;
  const bad = f.service.observe(() => { throw Error("observer failed"); });
  const off = f.service.observe(state => {
    if (state?.panels.toc.open && !changed) {
      changed = true; state.panels.toc.open = false;
      f.view.panels.toc = { open: false, visible: false }; f.commit();
    }
  });
  const request = f.service.setPanel("toc", true); await tick(); f.commit();
  expect((await request).snapshot.panels.toc.open).toBe(true); expect(f.service.snapshot()?.panels.toc.open).toBe(false);
  expect(f.errors.length).toBeGreaterThan(0); bad(); off(); f.binding.dispose();
});
