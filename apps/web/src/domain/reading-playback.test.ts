import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadAloudController, type PlaybackCallbacks } from "../features/reader/lib/read-aloud-controller";

function fixture() {
  const runtime = new ReadingSessionController();
  const id = runtime.begin("book");
  const location = { bookId: "book", contentVersion: "v1", cfi: "first" };
  runtime.attach(id, { navigate: async () => location, step: async () => location }, location);
  let callbacks!: PlaybackCallbacks;
  let stops = 0;
  const controller = new ReadAloudController({ systemAvailable: () => true,
    speak: (_text, next) => { callbacks = next; return { cancel: () => { stops++; } }; },
    play: () => { throw new Error("No provider expected"); }, report: () => {},
  });
  controller.update({ enabled: true, unit: { text: "Test unit", cfiRange: "first" }, voice: null, next: async () => "end-of-book", peekNext: () => null });
  const unbind = runtime.bindPlayback(id, controller);
  return { runtime, id, controller, unbind, started: () => callbacks.onStart(), stops: () => stops };
}

test("both actors use the attached audio and snapshot revisions reflect real transitions", async () => {
  const { runtime, id, controller, started } = fixture();
  const revisions: number[] = [];
  const off = runtime.observe(state => { revisions.push(state.revision); });
  const work = runtime.controlPlayback("start", "agent", undefined, { bookId: "book", sessionId: id });
  expect(runtime.snapshot().playback).toMatchObject({ status: "preparing", owner: "agent" });
  started();
  expect(await work).toMatchObject({ status: "completed", sessionId: id, playback: { status: "playing" } });
  const stopped = await runtime.controlPlayback("stop", "plugin:listener", undefined, { sessionId: id });
  expect(stopped.playback.status).toBe("stopped");
  expect(revisions.length).toBeGreaterThan(3);
  expect(new Set(revisions).size).toBe(revisions.length);
  expect(JSON.stringify(runtime.snapshot().playback)).not.toContain("Test unit");
  off(); controller.stop();
});

test("book replacement aborts synthesis/playing and old cleanup cannot detach the new reader", async () => {
  const { runtime, id, controller, unbind, stops } = fixture();
  const work = runtime.controlPlayback("start", "plugin:listener").catch(error => error);
  const other = runtime.begin("other");
  expect(await work).toMatchObject({ code: "reader/superseded" });
  expect(stops()).toBe(1);
  const otherLocation = { bookId: "other", contentVersion: "v1", cfi: "other" };
  runtime.attach(other, { navigate: async () => otherLocation, step: async () => otherLocation }, otherLocation);
  runtime.bindPlayback(other, controller);
  unbind();
  await expect(runtime.controlPlayback("stop", "agent", undefined, { sessionId: id })).rejects.toMatchObject({ code: "reader/superseded" });
  expect((await runtime.controlPlayback("stop", "agent", undefined, { sessionId: other })).sessionId).toBe(other);
  runtime.closed();
  expect(runtime.snapshot().playback).toMatchObject({ status: "unavailable", unavailableReason: "no-session" });
});

test("aborted or invalid calls have no playback effect", async () => {
  const { runtime } = fixture();
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(runtime.controlPlayback("start", "agent", abort.signal)).rejects.toThrow("cancelled");
  await expect(runtime.controlPlayback("pause" as "start", "agent")).rejects.toMatchObject({ code: "reader/invalid-target" });
  expect(runtime.snapshot().playback.status).toBe("stopped");
});
