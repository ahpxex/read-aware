import { expect, test } from "bun:test";
import { ReadingModeController, type ModeFeedback } from "./reading-mode-controller";

const descriptor = { key: "sentences:mode", label: "Sentences", defaultUnitId: "sentence",
  units: [{ id: "sentence", label: "Sentence" }, { id: "paragraph", label: "Paragraph" }] };
const ready: ModeFeedback = { status: "ready", progress: { ordinal: 1, total: 4 }, cfiRange: "unit" };
function fixture(deadline = 1000) {
  const controller = new ReadingModeController(false, null, deadline);
  controller.environment(descriptor, true);
  const feedback = (value: ModeFeedback) => controller.feedback(controller.requested().revision, descriptor.key, controller.requested().unitId, value);
  feedback({ status: "inactive", progress: null, cfiRange: null });
  return { controller, feedback };
}

test("mode configuration completes on matching actual indexing, never an old ready snapshot", async () => {
  const { controller, feedback } = fixture();
  const oldRevision = controller.requested().revision;
  let complete = false;
  const work = controller.configure({ active: true, unitId: "paragraph", modeKey: descriptor.key }).then(value => { complete = true; return value; });
  controller.feedback(oldRevision, descriptor.key, "paragraph", ready);
  await Promise.resolve();
  expect(complete).toBe(false);
  expect(controller.snapshot()).toMatchObject({ status: "preparing", requestedActive: true, unitId: "paragraph" });
  feedback(ready);
  expect(await work).toMatchObject({ status: "ready", cfiRange: "unit", progress: { ordinal: 1, total: 4 } });
  const revision = controller.requested().revision;
  expect((await controller.configure({ active: true })).status).toBe("ready");
  expect(controller.requested().revision).toBe(revision);
});

test("stop waits for deactivation and empty differs from failure", async () => {
  const { controller, feedback } = fixture();
  const start = controller.configure({ active: true }); feedback({ status: "empty", progress: null, cfiRange: null });
  expect((await start).status).toBe("empty");
  const stop = controller.configure({ active: false });
  feedback(ready);
  let done = false; void stop.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  feedback({ status: "inactive", progress: null, cfiRange: null }); await stop;
  const failed = controller.configure({ active: true });
  feedback({ status: "error", errorCode: "reader/segmentation-failed", progress: null, cfiRange: null });
  await expect(failed).rejects.toMatchObject({ code: "reader/segmentation-failed" });
});

test("abort rolls back only unfinished actor state, while a user takeover owns its own state", async () => {
  const { controller, feedback } = fixture();
  const abort = new AbortController();
  const work = controller.configure({ active: true, unitId: "paragraph" }, abort.signal);
  const obsolete = controller.requested().revision;
  abort.abort(new Error("cancelled"));
  await expect(work).rejects.toThrow("cancelled");
  expect(controller.requested()).toMatchObject({ active: false, unitId: "sentence" });
  controller.feedback(obsolete, descriptor.key, "paragraph", ready);
  expect(controller.snapshot().requestedActive).toBe(false);
  const owner = new AbortController();
  const first = controller.configure({ active: true }, owner.signal);
  controller.choose(true, "paragraph");
  await expect(first).rejects.toMatchObject({ code: "reader/superseded" });
  feedback(ready); owner.abort();
  expect(controller.snapshot()).toMatchObject({ status: "ready", requestedActive: true, unitId: "paragraph" });
});

test("superseded requests cannot become a cancelled successor's rollback target", async () => {
  const { controller } = fixture();
  const first = controller.configure({ active: true });
  const owner = new AbortController();
  const second = controller.configure({ active: true, unitId: "paragraph" }, owner.signal);
  await expect(first).rejects.toMatchObject({ code: "reader/superseded" });
  owner.abort(); await expect(second).rejects.toBeDefined();
  expect(controller.requested()).toMatchObject({ active: false, unitId: "sentence" });
});

test("completed preference changes survive caller lifecycle end", async () => {
  const { controller, feedback } = fixture(); const owner = new AbortController();
  const work = controller.configure({ active: true }, owner.signal); feedback(ready); await work;
  owner.abort(); expect(controller.snapshot().status).toBe("ready");
});

test("provider/format changes and retirement reject pending requests", async () => {
  const { controller } = fixture();
  const work = controller.configure({ active: true }); controller.environment(null, true);
  await expect(work).rejects.toMatchObject({ code: "reader/superseded" });
  expect(controller.snapshot().unavailableReason).toBe("no-provider");
  expect(controller.requested().active).toBe(false);
  controller.choose(false);
  expect((await controller.configure({ active: false })).requestedActive).toBe(false);
  controller.environment(descriptor, false);
  await expect(controller.configure({ active: true })).rejects.toMatchObject({ code: "reader/unavailable" });
  expect(controller.snapshot().unavailableReason).toBe("unsupported-format");
  controller.environment(descriptor, true);
  const current = controller.configure({ active: true }); controller.retire();
  await expect(current).rejects.toMatchObject({ code: "reader/superseded" });
  expect(controller.requested().active).toBe(false);
});

test("invalid configuration has no effects and unsettled operations time out", async () => {
  const { controller } = fixture(10); const revision = controller.requested().revision;
  for (const input of [{ active: "yes" }, { active: true, unitId: "unknown" }, { active: true, modeKey: "other:mode" }]) {
    await expect(controller.configure(input as { active: boolean })).rejects.toBeDefined();
  }
  expect(controller.requested().revision).toBe(revision);
  await expect(controller.configure({ active: true })).rejects.toMatchObject({ code: "reader/timeout" });
  expect(controller.requested().active).toBe(false);
});

const other = { key: "other:mode", label: "Other", defaultUnitId: "block", units: [{ id: "block", label: "Block" }] };
const inactive: ModeFeedback = { status: "inactive", progress: null, cfiRange: null };

test("provider selection validates target units and awaits the selected provider, without leaking implementations", async () => {
  const { controller } = fixture();
  const implementation = () => [];
  controller.environment([descriptor, { ...other, implementation }], true);
  expect(controller.snapshot().availableModes).toEqual([descriptor, other]);
  await expect(controller.configure({ active: true, selectModeKey: other.key, unitId: "sentence" })).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(controller.configure({ active: true, selectModeKey: "absent:mode" })).rejects.toMatchObject({ code: "reader/unavailable" });
  expect(controller.requested().modeKey).toBe(descriptor.key);
  const work = controller.configure({ active: true, selectModeKey: other.key, modeKey: descriptor.key });
  expect(controller.requested()).toMatchObject({ modeKey: other.key, unitId: "block" });
  controller.feedback(controller.generation(), descriptor.key, "block", ready);
  expect(controller.snapshot().status).toBe("preparing");
  controller.feedback(controller.generation(), other.key, "block", ready);
  expect(await work).toMatchObject({ modeKey: other.key, status: "ready" });
  await expect(controller.configure({ active: false, modeKey: descriptor.key })).rejects.toMatchObject({ code: "reader/superseded" });
});

test("provider catalog churn retains selection and does not interrupt unrelated work", async () => {
  const { controller } = fixture();
  const work = controller.configure({ active: true });
  const revision = controller.generation();
  controller.environment([descriptor, other], true);
  expect(controller.generation()).toBe(revision);
  controller.feedback(revision, descriptor.key, "sentence", ready);
  await work;
  controller.environment([other], true);
  expect(controller.snapshot()).toMatchObject({ modeKey: descriptor.key, requestedActive: true, unavailableReason: "no-provider", availableModes: [other] });
  controller.environment([other, descriptor], true);
  expect(controller.snapshot()).toMatchObject({ modeKey: descriptor.key, status: "preparing" });
});

test("selection cancellation restores the prior provider and unit, not a superseded intermediate choice", async () => {
  const { controller } = fixture();
  controller.environment([descriptor, other], true);
  const initial = controller.configure({ active: true, selectModeKey: other.key });
  const abort = new AbortController();
  const next = controller.configure({ active: true, selectModeKey: descriptor.key, unitId: "paragraph" }, abort.signal);
  await expect(initial).rejects.toMatchObject({ code: "reader/superseded" });
  abort.abort(new Error("cancel selection"));
  await expect(next).rejects.toThrow("cancel selection");
  expect(controller.requested()).toMatchObject({ modeKey: descriptor.key, unitId: "sentence", active: false });
});

test("a selected provider implementation replacement invalidates in-flight feedback", async () => {
  const { controller } = fixture();
  const work = controller.configure({ active: true });
  const revision = controller.generation();
  controller.environment([{ ...descriptor, implementation: () => [] }], true);
  await expect(work).rejects.toMatchObject({ code: "reader/superseded" });
  controller.feedback(revision, descriptor.key, "sentence", ready);
  expect(controller.snapshot().status).toBe("inactive");
});

test("saved provider and provider-specific unit win over registration order", async () => {
  const controller = new ReadingModeController(false, null, 1000, descriptor.key, key => key === descriptor.key ? "paragraph" : null);
  controller.environment([other, descriptor], true);
  expect(controller.requested()).toMatchObject({ modeKey: descriptor.key, unitId: "paragraph" });
  const work = controller.configure({ active: false, selectModeKey: other.key });
  controller.feedback(controller.generation(), other.key, "block", inactive);
  await work;
  const back = controller.configure({ active: false, selectModeKey: descriptor.key });
  controller.feedback(controller.generation(), descriptor.key, "paragraph", inactive);
  expect(await back).toMatchObject({ unitId: "paragraph", modeKey: descriptor.key });
});

test("legacy unit preferences survive first-provider adoption unless that provider has an explicit preference", () => {
  const legacy = new ReadingModeController(false, "paragraph");
  legacy.environment(descriptor, true);
  expect(legacy.requested().unitId).toBe("paragraph");
  const configured = new ReadingModeController(false, "paragraph", 1000, null, () => "sentence");
  configured.environment(descriptor, true);
  expect(configured.requested().unitId).toBe("sentence");
});
