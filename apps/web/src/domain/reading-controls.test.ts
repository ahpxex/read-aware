import { expect, test } from "bun:test";
import { ReadingControlsController } from "../features/reader/lib/reading-controls-controller";
import { ReadingSessionController } from "./reading-session-controller";

function fixture(deadline = 1000) {
  const errors: unknown[] = [];
  const controls = new ReadingControlsController(error => errors.push(error), deadline);
  const runtime = new ReadingSessionController(error => errors.push(error));
  const id = runtime.begin("book");
  const at = { bookId: "book", contentVersion: "v1", cfi: "start" };
  runtime.attach(id, { navigate: async () => at, step: async () => at }, at);
  const unbind = runtime.bindControls(id, controls);
  const commit = () => controls.acknowledge(controls.getRenderState());
  return { controls, runtime, id, commit, unbind, errors };
}

test("visibility is published and acknowledged only after render, without navigation or playback changes", async () => {
  const f = fixture(); const before = f.runtime.snapshot();
  const revisions: number[] = [];
  f.runtime.observe(state => revisions.push(state.revision));
  let settled = false;
  const pending = f.runtime.setControls(true, undefined, { sessionId: f.id, bookId: "book" })
    .then(value => { settled = true; return value; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.controls.getRenderState().visible).toBe(true);
  expect(f.runtime.snapshot().controls).toEqual({ visible: false });
  f.commit();
  expect(await pending).toEqual({ status: "completed", sessionId: f.id, controls: { visible: true } });
  const after = f.runtime.snapshot();
  expect(after).toEqual({ ...before, revision: after.revision, controls: { visible: true } });
  expect(revisions).toEqual([before.revision, before.revision + 1]);
  after.controls!.visible = false;
  expect(f.runtime.snapshot().controls).toEqual({ visible: true });
});

test("UI toggles share the same committed snapshot; repeated values still wait for their render", async () => {
  const f = fixture();
  f.controls.setFromUI(true); f.commit();
  expect(f.runtime.snapshot().controls).toEqual({ visible: true });
  const revision = f.runtime.snapshot().revision;
  let settled = false;
  const pending = f.runtime.setControls(true).then(value => { settled = true; return value; });
  await Promise.resolve(); expect(settled).toBe(false);
  f.commit(); await pending;
  expect(f.runtime.snapshot().revision).toBe(revision);
  f.controls.setFromUI(current => !current); f.commit();
  expect(f.runtime.snapshot().controls).toEqual({ visible: false });
});

test("new commands and UI intent supersede pending commands; old renders cannot acknowledge them", async () => {
  const f = fixture();
  const old = f.runtime.setControls(true).catch(error => error);
  const stale = f.controls.getRenderState();
  let settled = false;
  const next = f.runtime.setControls(false).then(value => { settled = true; return value; });
  expect(await old).toMatchObject({ code: "reader/superseded" });
  f.controls.acknowledge(stale); await Promise.resolve();
  expect(settled).toBe(false); expect(f.runtime.snapshot().controls?.visible).toBe(false);
  f.commit(); await next;
  const replaced = f.runtime.setControls(true).catch(error => error);
  f.controls.setFromUI(false); f.commit();
  expect(await replaced).toMatchObject({ code: "reader/superseded" });
});

test("abort and deadline discard uncommitted intent and reject late acknowledgements", async () => {
  for (const abortRequest of [true, false]) {
    const f = fixture(abortRequest ? 1000 : 5); const abort = new AbortController();
    const pending = f.runtime.setControls(true, abort.signal).catch(error => error);
    const stale = f.controls.getRenderState();
    if (abortRequest) abort.abort(new Error("cancel controls"));
    expect(await pending).toMatchObject(abortRequest ? { message: "cancel controls" } : { code: "reader/timeout" });
    f.controls.acknowledge(stale); f.commit();
    expect(f.runtime.snapshot().controls?.visible).toBe(false);
    expect(f.controls.getRenderState().visible).toBe(false);
  }
});

test("invalid inputs, pre-abort and stale guards fail before changing requested state", async () => {
  const f = fixture(); const before = f.controls.getRenderState();
  const abort = new AbortController(); abort.abort(new Error("already cancelled"));
  await expect(f.runtime.setControls(true, abort.signal)).rejects.toThrow("already cancelled");
  await expect(f.runtime.setControls("yes" as unknown as boolean)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(f.runtime.setControls(true, undefined, { sessionId: "old" })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(f.runtime.setControls(true, undefined, { bookId: "other" })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(f.controls.getRenderState()).toBe(before);
});

test("closing, loading failure and replacement retire pending requests and leave no writable stale adapter", async () => {
  for (const end of ["close", "fail", "replace", "unbind"] as const) {
    const f = fixture();
    const pending = f.runtime.setControls(true).catch(error => error);
    const stale = f.controls.getRenderState();
    if (end === "close") f.runtime.closed();
    if (end === "fail") f.runtime.fail(f.id, new Error("load failed"));
    if (end === "replace") f.runtime.begin("other");
    if (end === "unbind") f.unbind();
    expect(await pending).toMatchObject({ code: "reader/superseded" });
    f.controls.acknowledge(stale);
    expect(f.runtime.snapshot().controls).toBeNull();
    await expect(f.runtime.setControls(true)).rejects.toMatchObject({ code: "reader/unavailable" });
  }
});

test("stale binding disposal does not detach a newer session using the same UI controller", async () => {
  const f = fixture(); const id = f.runtime.begin("next");
  const at = { bookId: "next", contentVersion: "v1", cfi: "start" };
  f.runtime.attach(id, { navigate: async () => at, step: async () => at }, at);
  const dispose = f.runtime.bindControls(id, f.controls);
  f.unbind();
  const pending = f.runtime.setControls(true); f.commit();
  expect(await pending).toMatchObject({ sessionId: id, controls: { visible: true } });
  dispose(); dispose();
  expect(f.runtime.snapshot().controls).toBeNull();
});

test("observer failures are isolated and reentrant changes cannot rewrite the acknowledged receipt", async () => {
  const f = fixture();
  f.controls.observe(() => { throw new Error("observer failed"); });
  f.controls.observe(() => {
    if (f.controls.snapshot().visible) { f.controls.setFromUI(false); f.commit(); }
  });
  const pending = f.runtime.setControls(true); f.commit();
  expect(await pending).toMatchObject({ controls: { visible: true } });
  expect(f.runtime.snapshot().controls).toEqual({ visible: false });
  expect(f.errors).toHaveLength(2);
});
