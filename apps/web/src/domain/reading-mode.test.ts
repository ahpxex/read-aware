import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadingModeController } from "../features/reader/lib/reading-mode-controller";
import { AppError } from "@read-aware/core";

function fixture() {
  const runtime = new ReadingSessionController();
  const id = runtime.begin("book");
  const location = { bookId: "book", contentVersion: "v1", cfi: "first" };
  const detach = runtime.attach(id, { navigate: async () => location, step: async () => location }, location);
  const controller = new ReadingModeController();
  controller.bindPositionWaiter(async position => {
    const feedback = { status: "ready" as const, progress: { ordinal: 0, total: 1 }, cfiRange: position.location.cfi, position };
    controller.feedback(controller.generation(), position.modeKey, position.unitId, feedback);
    return feedback;
  });
  controller.environment({ key: "test:mode", label: "Test mode", defaultUnitId: "sentence", units: [{ id: "sentence", label: "Sentence" }] }, true);
  const unbind = runtime.bindMode(id, controller);
  const ready = () => controller.feedback(controller.requested().revision, "test:mode", "sentence", {
    status: "ready", progress: { ordinal: 1, total: 2 }, cfiRange: "first",
  });
  return { runtime, id, controller, unbind, detach, ready };
}

test("unit steps wait for committed consumers, return boundaries and never add jump history", async () => {
  const { runtime, id, controller, ready } = fixture();
  const configured = runtime.configureMode({ active: true }); ready(); await configured;
  const feedback = { status: "ready" as const, progress: { ordinal: 2, total: 3 }, cfiRange: "next" };
  let direction: number | undefined;
  controller.bindStepper(async value => { direction = value; return { outcome: "moved", feedback }; });
  let done = false;
  const work = runtime.stepMode("next", undefined, { sessionId: id, bookId: "book" }).then(result => { done = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(direction).toBe(1); expect(done).toBe(false);
  controller.feedback(controller.generation(), "test:mode", "sentence", feedback);
  expect(await work).toMatchObject({ status: "completed", outcome: "moved", mode: { cfiRange: "next" } });
  expect(runtime.snapshot().history.canGoBack).toBe(false);
  controller.bindStepper(async () => ({ outcome: "end-of-book", feedback }));
  expect((await runtime.stepMode("next")).outcome).toBe("end-of-book");
  controller.bindStepper(async () => ({ outcome: "start-of-book", feedback }));
  expect((await runtime.stepMode("previous")).outcome).toBe("start-of-book");
  runtime.closed();
});

test("new navigation cancels unit traversal and waits for its renderer work to release", async () => {
  const { runtime, controller, ready } = fixture();
  const configured = runtime.configureMode({ active: true }); ready(); await configured;
  let cancelled = false;
  let finish!: () => void;
  controller.bindStepper(async (_direction, signal) => {
    await new Promise<void>(resolve => { finish = resolve; signal.addEventListener("abort", () => { cancelled = true; }, { once: true }); });
    if (signal.aborted) throw signal.reason;
    throw new Error("Unexpected uncancelled step");
  });
  const step = runtime.stepMode("next").catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  let moved = false;
  const newer = runtime.navigate({ fraction: 0.8 }).then(() => { moved = true; });
  expect(await step).toMatchObject({ code: "reader/superseded" });
  expect(cancelled).toBe(true); expect(moved).toBe(false);
  finish(); await newer;
  expect(moved).toBe(true);
  runtime.closed();
});

test("mode changes, detachment, failure and invalid scope never yield unit success", async () => {
  const { runtime, controller, ready, unbind } = fixture();
  const configured = runtime.configureMode({ active: true }); ready(); await configured;
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(runtime.stepMode("next", abort.signal)).rejects.toThrow("cancelled");
  await expect(runtime.stepMode("next", undefined, { bookId: "other" })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(runtime.stepMode("wrong" as "next")).rejects.toMatchObject({ code: "reader/invalid-target" });
  controller.bindStepper(async () => { throw new AppError("reader/segmentation-failed", "failure"); });
  await expect(runtime.stepMode("next")).rejects.toMatchObject({ code: "reader/segmentation-failed" });
  controller.bindStepper((_direction, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const changing = runtime.stepMode("next").catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.choose(false);
  expect(await changing).toMatchObject({ code: "reader/superseded" });
  const active = runtime.configureMode({ active: true }); ready(); await active;
  const detached = runtime.stepMode("next").catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0)); unbind();
  expect(await detached).toMatchObject({ code: "reader/superseded" });
  runtime.closed();
});

test("shared mode snapshot observes real preparation/completion and is isolated from consumer mutation", async () => {
  const { runtime, id, ready } = fixture();
  const revisions: number[] = [];
  const off = runtime.observe(state => { revisions.push(state.revision); });
  const work = runtime.configureMode({ active: true }, undefined, { sessionId: id, bookId: "book" });
  expect(runtime.snapshot().mode.status).toBe("preparing");
  ready();
  const receipt = await work;
  expect(receipt).toMatchObject({ status: "completed", sessionId: id, mode: { status: "ready", cfiRange: "first" } });
  receipt.mode.units[0]!.label = "mutated";
  expect(runtime.snapshot().mode.units[0]!.label).toBe("Sentence");
  expect(new Set(revisions).size).toBe(revisions.length);
  off(); runtime.closed();
});

test("close rejects an unfinished mode change and obsolete feedback cannot mutate a replacement session", async () => {
  const { runtime, id, controller, unbind, ready } = fixture();
  const work = runtime.configureMode({ active: true }).catch(error => error);
  runtime.closed();
  expect(await work).toMatchObject({ code: "reader/superseded" });
  ready();
  expect(runtime.snapshot().mode.unavailableReason).toBe("no-session");
  const other = runtime.begin("other");
  const location = { bookId: "other", contentVersion: "v1", cfi: "other" };
  runtime.attach(other, { navigate: async () => location, step: async () => location }, location);
  runtime.bindMode(other, controller);
  unbind();
  await expect(runtime.configureMode({ active: false }, undefined, { sessionId: id })).rejects.toMatchObject({ code: "reader/superseded" });
  const stopped = runtime.configureMode({ active: false }, undefined, { sessionId: other });
  controller.feedback(controller.requested().revision, "test:mode", "sentence", { status: "inactive", progress: null, cfiRange: null });
  expect((await stopped).mode.status).toBe("inactive");
  runtime.closed();
});

test("invalid guards, cancelled calls and a detached engine do not change mode preferences", async () => {
  const { runtime, controller, detach } = fixture();
  const before = controller.requested();
  await expect(runtime.configureMode({ active: true }, undefined, { bookId: "other" })).rejects.toMatchObject({ code: "reader/superseded" });
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(runtime.configureMode({ active: true }, abort.signal)).rejects.toThrow("cancelled");
  detach();
  await expect(runtime.configureMode({ active: true })).rejects.toMatchObject({ code: "reader/unavailable" });
  expect(controller.requested()).toBe(before);
  runtime.closed();
});

test("return waits for both renderer and asynchronous unit restoration before committing history", async () => {
  const { runtime, id, controller } = fixture();
  const active = runtime.configureMode({ active: true });
  controller.feedback(controller.requested().revision, "test:mode", "sentence", { status: "ready", progress: null, cfiRange: null,
    position: { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "resting" } } });
  await active;
  let target: unknown; let finish!: () => void;
  const location = { bookId: "book", contentVersion: "v1", cfi: "away" };
  runtime.attach(id, { navigate: async next => { target = next; await new Promise<void>(resolve => { finish = resolve; }); return { ...location, cfi: "resting" }; }, step: async () => location }, location);
  let done = false;
  let restore!: () => void;
  controller.bindPositionWaiter(async position => {
    await new Promise<void>(resolve => { restore = resolve; });
    return { status: "ready", progress: { ordinal: 0, total: 1 }, cfiRange: "resting", position };
  });
  const work = runtime.returnToMode(undefined, { sessionId: id }).then(result => { done = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(done).toBe(false);
  expect(target).toEqual({ bookId: "book", contentVersion: "v1", cfi: "resting" });
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(done).toBe(false);
  expect(runtime.snapshot().history.canGoBack).toBe(false);
  restore(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(done).toBe(false);
  controller.feedback(controller.generation(), "test:mode", "sentence", { status: "ready", cfiRange: "resting", progress: { ordinal: 0, total: 1 },
    position: { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "resting" } } });
  expect((await work).location.cfi).toBe("resting");
  expect(runtime.snapshot().mode.cfiRange).toBe("resting");
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(runtime.returnToMode(abort.signal)).rejects.toThrow("cancelled");
  runtime.closed();
  await expect(runtime.returnToMode()).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("a newer navigation cancels a return still waiting on segmentation", async () => {
  const { runtime, controller } = fixture();
  const active = runtime.configureMode({ active: true });
  controller.feedback(controller.requested().revision, "test:mode", "sentence", { status: "ready", progress: null, cfiRange: null,
    position: { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "resting" } } });
  await active;
  let cancelled = false;
  controller.bindPositionWaiter((_position, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
  }));
  const returning = runtime.returnToMode().catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  await runtime.navigate({ fraction: 0.8 });
  expect(await returning).toMatchObject({ code: "reader/superseded" });
  expect(cancelled).toBe(true);
  runtime.closed();
});

test("return refuses a stale content version or mode identity without moving the renderer", async () => {
  const { runtime, controller } = fixture();
  const active = runtime.configureMode({ active: true });
  const position = { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "old", cfi: "resting" } };
  const feedback = () => controller.feedback(controller.requested().revision, "test:mode", "sentence", { status: "ready", progress: null, cfiRange: null, position });
  feedback(); await active;
  await expect(runtime.returnToMode()).rejects.toMatchObject({ code: "reader/stale-location" });
  position.modeKey = "other:mode"; feedback();
  await expect(runtime.returnToMode()).rejects.toMatchObject({ code: "reader/unavailable" });
  expect(runtime.snapshot().location?.cfi).toBe("first");
  runtime.closed();
});

test("changing mode cancels an in-flight return before it can commit navigation history", async () => {
  const { runtime, id, controller } = fixture();
  const active = runtime.configureMode({ active: true });
  controller.feedback(controller.requested().revision, "test:mode", "sentence", { status: "ready", progress: null, cfiRange: null,
    position: { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "resting" } } });
  await active;
  const location = { bookId: "book", contentVersion: "v1", cfi: "away" };
  let finish!: () => void;
  runtime.attach(id, { navigate: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { ...location, cfi: "resting" }; }, step: async () => location }, location);
  const work = runtime.returnToMode().catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.choose(false);
  expect(await work).toMatchObject({ code: "reader/superseded" });
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(runtime.snapshot().location?.cfi).toBe("away");
  expect(runtime.snapshot().history.canGoBack).toBe(false);
  runtime.closed();
});
