import { expect, test } from "bun:test";
import { ReadAloudController, type PlaybackCallbacks, type PlaybackInput, type PlaybackVoice } from "./read-aloud-controller";

function fixture(deadline = 1000) {
  const calls: { backend: string; callbacks: PlaybackCallbacks; cancelled: boolean }[] = [];
  const errors: unknown[] = [];
  let system = true;
  const output = (backend: string, callbacks: PlaybackCallbacks) => {
    const call = { backend, callbacks, cancelled: false }; calls.push(call);
    return { cancel() { call.cancelled = true; } };
  };
  const controller = new ReadAloudController({
    systemAvailable: () => system,
    speak: (_text, callbacks) => output("system", callbacks),
    play: (_bytes, callbacks) => output("plugin", callbacks),
    report: error => errors.push(error),
  }, deadline, deadline);
  let input: PlaybackInput = { enabled: true, unit: { text: "First passage", cfiRange: "first" }, voice: null, next() {}, peekNext: () => null };
  const update = (patch: Partial<PlaybackInput>) => { input = { ...input, ...patch }; controller.update(input); };
  update({});
  return { controller, calls, errors, update, noSystem: () => { system = false; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("start waits for actual audio; stop cancels and cannot be revived by stale callbacks", async () => {
  const { controller, calls } = fixture();
  let completed = false;
  const work = controller.start("agent").then(() => { completed = true; });
  await tick();
  expect(completed).toBe(false);
  expect(controller.snapshot()).toMatchObject({ status: "preparing", owner: "agent", backend: "system" });
  calls[0]!.callbacks.onStart(); await work;
  expect(controller.snapshot().status).toBe("playing");
  controller.stop();
  calls[0]!.callbacks.onEnd(); calls[0]!.callbacks.onError("late");
  expect(calls[0]!.cancelled).toBe(true);
  expect(controller.snapshot()).toMatchObject({ status: "stopped", owner: null });
});

test("a cancelled synthesis failure cannot stop a newer run or trigger fallback", async () => {
  const { controller, calls, update, errors } = fixture();
  let reject!: (error: unknown) => void;
  update({ voice: { synthesize: () => new Promise((_resolve, fail) => { reject = fail; }) } });
  const old = controller.start("plugin:old").catch(error => error);
  update({ voice: null });
  const current = controller.start("user");
  const newCall = calls.at(-1)!;
  newCall.callbacks.onStart(); await current;
  reject(new Error("old provider failed")); await tick();
  expect(await old).toMatchObject({ code: "reader/superseded" });
  expect(errors).toHaveLength(0);
  expect(controller.snapshot()).toMatchObject({ status: "playing", owner: "user", fallback: false });
  controller.stop();
});

test("provider failure reports fallback and only system onStart completes the command", async () => {
  const { controller, calls, update, errors } = fixture();
  update({ voice: { synthesize: async () => { throw new Error("offline"); } } });
  const work = controller.start("plugin:listener"); await tick();
  expect(errors).toHaveLength(1);
  expect(controller.snapshot()).toMatchObject({ status: "preparing", backend: "system", fallback: true });
  calls[0]!.callbacks.onStart(); await work;
  expect(controller.snapshot().status).toBe("playing");
  controller.stop();
});

test("plugin lifecycle cancellation stops ongoing audio but old owner cancellation cannot stop user takeover", async () => {
  const { controller, calls } = fixture(); const lifecycle = new AbortController();
  const work = controller.start("plugin:listener", lifecycle.signal); calls[0]!.callbacks.onStart(); await work;
  lifecycle.abort();
  expect(calls[0]!.cancelled).toBe(true);
  expect(controller.snapshot().status).toBe("stopped");
  const old = new AbortController();
  const first = controller.start("plugin:listener", old.signal); calls[1]!.callbacks.onStart(); await first;
  const second = controller.start("user"); calls[2]!.callbacks.onStart(); await second;
  old.abort();
  expect(controller.snapshot()).toMatchObject({ owner: "user", status: "playing" });
  controller.stop();
});

test("mode/provider unavailability stops playback and exposes the reason", async () => {
  const { controller, calls, update, noSystem } = fixture();
  const work = controller.start("user"); calls[0]!.callbacks.onStart(); await work;
  update({ enabled: false });
  expect(controller.snapshot()).toMatchObject({ status: "unavailable", unavailableReason: "mode-inactive" });
  await expect(controller.start("agent")).rejects.toMatchObject({ code: "reader/unavailable" });
  noSystem(); update({ enabled: true });
  expect(controller.snapshot().unavailableReason).toBe("no-voice");
});

test("hung synthesis times out, rejects, and late completion never plays", async () => {
  const { controller, calls, update } = fixture(10);
  let resolve!: (bytes: ArrayBuffer) => void;
  update({ voice: { synthesize: () => new Promise(done => { resolve = done; }) } });
  await expect(controller.start("agent")).rejects.toMatchObject({ code: "reader/timeout" });
  expect(controller.snapshot()).toMatchObject({ status: "error", errorCode: "reader/timeout" });
  resolve(new ArrayBuffer(4)); await tick();
  expect(calls).toHaveLength(0);
});

test("auto-advance waits across a missing unit and resumes at the next actual unit", async () => {
  const { controller, calls, update } = fixture(); let steps = 0;
  update({ next: () => { steps++; update({ unit: null }); } });
  const work = controller.start("user"); calls[0]!.callbacks.onStart(); await work;
  calls[0]!.callbacks.onEnd();
  expect(steps).toBe(1);
  expect(controller.snapshot().status).toBe("advancing");
  update({ unit: { text: "Second", cfiRange: "second" } });
  calls[1]!.callbacks.onStart();
  expect(controller.snapshot()).toMatchObject({ status: "playing", cfiRange: "second" });
  controller.stop();
});

test("audio ending without a start is a failure, not a successful command", async () => {
  const { controller, calls } = fixture();
  const work = controller.start("agent"); calls[0]!.callbacks.onEnd();
  await expect(work).rejects.toMatchObject({ code: "reader/playback-failed" });
});

test("every automatic unit must start, not only the first command's unit", async () => {
  const { controller, calls, update } = fixture();
  update({ next: () => update({ unit: { text: "Second", cfiRange: "second" } }) });
  const work = controller.start("agent");
  calls[0]!.callbacks.onStart(); await work;
  calls[0]!.callbacks.onEnd();
  calls[1]!.callbacks.onEnd();
  expect(controller.snapshot()).toMatchObject({ status: "error", errorCode: "reader/playback-failed" });
  expect(calls).toHaveLength(2);
});

test("duplicate audio callbacks do not skip units while navigation is pending", async () => {
  const { controller, calls, update } = fixture();
  let steps = 0;
  update({ next: () => { steps++; } });
  const work = controller.start("agent");
  calls[0]!.callbacks.onStart(); await work;
  calls[0]!.callbacks.onEnd();
  calls[0]!.callbacks.onStart();
  calls[0]!.callbacks.onEnd();
  expect(controller.snapshot().status).toBe("advancing");
  expect(steps).toBe(1);
  controller.stop();
});

test("late prefetch for identical text cannot populate a restarted session cache", async () => {
  const { controller, calls, update } = fixture();
  const pending: { text: string; resolve(bytes: ArrayBuffer): void }[] = [];
  const voice: PlaybackVoice = { synthesize: text => new Promise(resolve => pending.push({ text, resolve })) };
  update({ voice, peekNext: () => "Second" });
  const work = controller.start("user"); pending[0]!.resolve(new ArrayBuffer(4)); await tick();
  calls[0]!.callbacks.onStart(); await work;
  controller.stop();
  const next = controller.start("user"); pending[2]!.resolve(new ArrayBuffer(4)); await tick();
  calls[1]!.callbacks.onStart(); await next;
  pending[1]!.resolve(new ArrayBuffer(4)); await tick();
  update({ unit: { text: "Second", cfiRange: "second" } });
  expect(pending.at(-1)?.text).toBe("Second");
  expect(pending).toHaveLength(5);
  controller.stop();
});
