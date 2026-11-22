import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

test("reading time reaches the store in whole milliseconds, losing none of the clock's fractions", async () => {
  // The native command takes `deltaMs` as an integer and refuses anything
  // else, which the reader surfaced as an error toast on close. The fake sits
  // at the shell boundary: the trace runtime binds its store when it first
  // loads, so a module mock would miss it whenever an earlier test file in the
  // same process loaded it first.
  const stored: number[] = [];
  const invoke = async (command: string, args: { deltaMs?: number }) => {
    if (command === "reading_sessions_pending") return [];
    if (command === "reading_session_accrue") {
      if (!Number.isSafeInteger(args.deltaMs)) throw new Error(`deltaMs ${args.deltaMs} is not an integer`);
      stored.push(args.deltaMs!);
      return null;
    }
    throw new Error(`Unexpected IPC ${command}`);
  };
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  dom.window.document.hasFocus = () => true;
  Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke } });
  let now = 1000.1;
  const values = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  const { readingTraces } = await import("../lib/reading-trace-runtime");
  const { useReadingTimeTracker } = await import("./useReadingTimeTracker");
  const trace = readingTraces.begin("session", "book");
  let sample: (() => void) | undefined;
  const bind = trace.bindSampler.bind(trace);
  trace.bindSampler = (sampler: () => void) => {
    sample = sampler;
    return bind(sampler);
  };
  function Reader() {
    useReadingTimeTracker("book", true);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(<Reader />));
    // Sampled at the fractional instants performance.now() really returns.
    for (const at of [8490.35, 9690.75, 12000.333]) {
      now = at;
      dom.window.dispatchEvent(new dom.window.Event("pointermove"));
      await act(async () => {
        sample?.();
      });
    }
    // Retiring the session drains its write queue and rethrows a refused write.
    await act(async () => readingTraces.settle());
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every(Number.isSafeInteger)).toBe(true);
    // Every whole millisecond read is stored; less than one stays pending.
    expect(stored.reduce((sum, ms) => sum + ms, 0)).toBe(Math.floor(12000.333 - 1000.1));
  } finally {
    await act(async () => root.unmount());
    clock.mockRestore();
    for (const [key, descriptor] of globals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
  }
});
