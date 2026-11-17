import { expect, spyOn, test } from "bun:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ActiveReadingClock, IDLE_LIMIT_MS } from "../lib/reading-session-policy";
import { useSessionTimer } from "./useSessionTimer";

test("the session timer counts the reading clock's seconds from its own start, and starts over on re-entry", async () => {
  const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let time = 0;
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  const spies = [
    spyOn(performance, "now").mockImplementation(() => time),
    spyOn(dom.window, "setInterval").mockImplementation(((callback: () => void) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    }) as typeof dom.window.setInterval),
    spyOn(dom.window, "clearInterval").mockImplementation((id) => {
      callbacks.delete(id!);
    }),
  ];
  // The book has been read for a while before the timer appears.
  const clock = new ActiveReadingClock(0, true);
  time = 90_000;
  clock.sample(time);
  let result!: ReturnType<typeof useSessionTimer>;
  function Harness({ enabled }: { enabled: boolean }) {
    result = useSessionTimer(enabled, clock);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (enabled: boolean) =>
    act(async () =>
      root.render(
        <StrictMode>
          <Harness enabled={enabled} />
        </StrictMode>,
      ),
    );
  const tick = async (seconds: number) => {
    await act(async () => {
      for (let i = 0; i < seconds; i++) {
        time += 1000;
        for (const callback of callbacks.values()) callback();
      }
    });
  };
  try {
    await render(true);
    expect(callbacks.size).toBe(1);
    expect(result.elapsed).toBe("0:00");
    await tick(5);
    expect(result.elapsed).toBe("0:05");
    // Background time is the clock's to judge; the timer shows what it counted.
    clock.setForeground(time, false);
    await tick(10);
    expect(result.elapsed).toBe("0:05");
    clock.setForeground(time, true);
    await tick(3);
    expect(result.elapsed).toBe("0:08");
    // Idle past the stats' limit: counting stops IDLE_LIMIT_MS after the
    // return to the foreground (5s before it, plus the limit).
    await tick(IDLE_LIMIT_MS / 1000 + 5);
    expect(result.elapsed).toBe(`${IDLE_LIMIT_MS / 60_000}:05`);
    clock.activity(time, true);
    await tick(2);
    expect(result.elapsed).toBe(`${IDLE_LIMIT_MS / 60_000}:07`);
    await act(async () => result.toggleClock());
    expect(result.showClock).toBe(true);
    await act(async () => result.toggleClock());
    expect(result.showClock).toBe(false);
    await render(false);
    expect(result.elapsed).toBeNull();
    expect(callbacks.size).toBe(0);
    await render(true);
    expect(result.elapsed).toBe("0:00");
    await tick(1);
    expect(result.elapsed).toBe("0:01");
  } finally {
    await act(async () => root.unmount());
    for (const spy of spies) spy.mockRestore();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
