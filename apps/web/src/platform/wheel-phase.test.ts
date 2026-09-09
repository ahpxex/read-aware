import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { subscribeWheelPhaseEdges, WHEEL_PHASE_EVENT } from "./wheel-phase";

let dom: JSDOM;
let previous: PropertyDescriptor | undefined;
let calls: string[];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  dom = new JSDOM("", { url: "http://localhost" });
  previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: dom.window });
  calls = [];
  Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke: async (command: string) => { calls.push(command); } } });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  dom.window.close();
  if (previous) Object.defineProperty(globalThis, "window", previous);
  else Reflect.deleteProperty(globalThis, "window");
});
const emit = (detail: unknown) => dom.window.dispatchEvent(new dom.window.CustomEvent(WHEEL_PHASE_EVENT, { detail }));

test("input subscription is synchronous and has no native registration or delayed retirement", async () => {
  const seen: string[] = [];
  const stop = subscribeWheelPhaseEdges(edge => seen.push(edge));
  emit("touch"); stop(); stop(); emit("momentum");
  await Promise.resolve(); emit("end");
  expect(seen).toEqual(["touch"]); expect(calls).toEqual([]);
});

test("retired generations never receive events after rapid same-document reopen", async () => {
  const retired: string[] = [], current: string[] = [];
  for (let i = 0; i < 200; i++) {
    const stop = subscribeWheelPhaseEdges(edge => retired.push(edge)); stop();
  }
  cleanups.push(subscribeWheelPhaseEdges(edge => current.push(edge)));
  await Promise.resolve(); emit("touch"); emit("momentum"); emit("end");
  expect(retired).toEqual([]); expect(current).toEqual(["touch", "momentum", "end"]);
  expect(calls).toEqual([]);
});

test("independent consumers and removal during dispatch obey document listener ownership", () => {
  const seen: string[] = [];
  let stopSecond = () => {};
  cleanups.push(subscribeWheelPhaseEdges(edge => { seen.push(`first:${edge}`); stopSecond(); }));
  stopSecond = subscribeWheelPhaseEdges(edge => seen.push(`second:${edge}`)); cleanups.push(stopSecond);
  emit("touch"); expect(seen).toEqual(["first:touch"]);
  const third = subscribeWheelPhaseEdges(edge => seen.push(`third:${edge}`)); cleanups.push(third);
  emit("end"); expect(seen).toEqual(["first:touch", "first:end", "third:end"]);
});

test("invalid payloads and untyped events cannot change gesture state", () => {
  const seen: string[] = []; cleanups.push(subscribeWheelPhaseEdges(edge => seen.push(edge)));
  for (const value of [null, undefined, {}, 1, "changed", "Touch", ["touch"]]) emit(value);
  dom.window.dispatchEvent(new dom.window.Event(WHEEL_PHASE_EVENT));
  expect(seen).toEqual([]); emit("touch"); expect(seen).toEqual(["touch"]);
});

test("consumer throws and rejected async callbacks are logged without breaking peers", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {}); cleanups.push(() => warn.mockRestore());
  cleanups.push(subscribeWheelPhaseEdges(() => { throw Error("sync edge consumer"); }));
  cleanups.push(subscribeWheelPhaseEdges(async () => { throw Error("async edge consumer"); }));
  const seen: string[] = []; cleanups.push(subscribeWheelPhaseEdges(edge => seen.push(edge)));
  emit("end"); await Promise.resolve(); await Promise.resolve();
  expect(seen).toEqual(["end"]); expect(warn).toHaveBeenCalledTimes(2);
});

test("cleanup removes from the captured document even if the global window is replaced", () => {
  const seen: string[] = []; const stop = subscribeWheelPhaseEdges(edge => seen.push(edge));
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: undefined });
  stop(); emit("touch"); expect(seen).toEqual([]);
});

test("non-Tauri environments do not listen to spoofed native input", () => {
  Reflect.deleteProperty(dom.window, "__TAURI_INTERNALS__");
  const seen: string[] = []; const stop = subscribeWheelPhaseEdges(edge => seen.push(edge));
  emit("touch"); stop(); expect(seen).toEqual([]);
});
