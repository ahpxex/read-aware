import { expect, mock, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

test("reading time reaches the store in whole milliseconds, losing none of the clock's fractions", async () => {
  // The native command takes `deltaMs` as an integer and refuses anything
  // else, which the reader surfaced as an error toast on close.
  const stored: number[] = [];
  const platform = await import("../../../platform/reading-session");
  mock.module("../../../platform/reading-session", () => ({
    ...platform,
    accrueReadingSession: async (_bookId: string, deltaMs: number) => {
      if (!Number.isSafeInteger(deltaMs)) throw new Error(`deltaMs ${deltaMs} is not an integer`);
      stored.push(deltaMs);
      return null;
    },
    noteReadingPosition: async () => null,
  }));
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  dom.window.document.hasFocus = () => true;
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
