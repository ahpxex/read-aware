import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadingModeController } from "../features/reader/lib/reading-mode-controller";

function fixture() {
  const runtime = new ReadingSessionController();
  const id = runtime.begin("book");
  const location = { bookId: "book", contentVersion: "v1", cfi: "first" };
  const detach = runtime.attach(id, { navigate: async () => location, step: async () => location }, location);
  const controller = new ReadingModeController();
  controller.environment({ key: "test:mode", label: "Test mode", defaultUnitId: "sentence", units: [{ id: "sentence", label: "Sentence" }] }, true);
  const unbind = runtime.bindMode(id, controller);
  const ready = () => controller.feedback(controller.requested().revision, "test:mode", "sentence", {
    status: "ready", progress: { ordinal: 1, total: 2 }, cfiRange: "first",
  });
  return { runtime, id, controller, unbind, detach, ready };
}

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
