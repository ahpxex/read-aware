import { expect, spyOn, test } from "bun:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { SESSION_TIMER_IDLE_MS, useSessionTimer } from "./useSessionTimer";

test("session time pauses on idle/background, resumes from iframe activity, and survives clock toggles", async () => {
  const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let time = 0,
    focused = true,
    hidden = false;
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
  // JSDOM's document is a Proxy (since 30.1) that spyOn cannot patch;
  // own properties go through its defineProperty trap.
  Object.defineProperty(dom.window.document, "hasFocus", { configurable: true, value: () => focused });
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  const activityRef = { current: null as (() => void) | null };
  let result!: ReturnType<typeof useSessionTimer>;
  function Harness({ enabled }: { enabled: boolean }) {
    result = useSessionTimer(enabled, activityRef);
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
    await tick(5);
    expect(result.elapsed).toBe("0:05");
    await act(async () => {
      focused = false;
      dom.window.dispatchEvent(new dom.window.Event("blur"));
    });
    await tick(10);
    expect(result.elapsed).toBe("0:05");
    await act(async () => {
      focused = true;
      dom.window.dispatchEvent(new dom.window.Event("focus"));
    });
    await tick(SESSION_TIMER_IDLE_MS / 1000 + 5);
    expect(result.elapsed).toBe("1:05");
    // Moving within the book iframe forwards activity without a window event.
    await act(async () => activityRef.current?.());
    await tick(3);
    expect(result.elapsed).toBe("1:08");
    await act(async () => result.toggleClock());
    expect(result.showClock).toBe(true);
    await tick(2);
    await act(async () => result.toggleClock());
    expect(result.showClock).toBe(false);
    expect(result.elapsed).toBe("1:10");
    await act(async () => {
      hidden = true;
      dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    });
    await tick(10);
    expect(result.elapsed).toBe("1:10");
    await act(async () => {
      hidden = false;
      dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    });
    // Sleep/wake without any visibility event must not charge the gap.
    await act(async () => {
      time += 30_000;
      for (const callback of callbacks.values()) callback();
    });
    expect(result.elapsed).toBe("1:10");
    await tick(2);
    expect(result.elapsed).toBe("1:12");
    await render(false);
    expect(result.elapsed).toBeNull();
    expect(activityRef.current).toBeNull();
    expect(callbacks.size).toBe(0);
    await render(true);
    expect(result.elapsed).toBe("0:00");
    expect(result.showClock).toBe(false);
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
