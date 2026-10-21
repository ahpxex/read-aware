import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePanelSwipeDismiss } from "./usePanelSwipeDismiss";

test("edge back unwinds one page at a time and leaves scrolling, controls and canceled gestures alone", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let reducedMotion = false;
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: reducedMotion }) });
  let backs = 0;
  let enabled = true;
  let edgeOnly = true;
  let exit: "left" | "right" = "right";
  let reset!: (page: number | null) => void;
  function Harness() {
    const ref = useRef<HTMLElement | null>(null);
    const [page, setPage] = useState<number | null>(1);
    const [open, setOpen] = useState(true);
    reset = (next) => {
      setPage(next);
      setOpen(true);
    };
    usePanelSwipeDismiss(ref, {
      open,
      enabled,
      exit,
      edgeOnly,
      navigationKey: page,
      onDismiss: () => {
        backs++;
        if (page === null) setOpen(false);
        else setPage(null);
      },
    });
    return createElement(
      "section",
      { ref, role: "dialog", "data-open": open, "data-page": page ?? "list" },
      createElement("input", { type: "range" }),
      createElement("div", { role: "dialog", id: "nested" }),
    );
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(createElement(Harness)));
    const panel = dom.window.document.querySelector("section")!;
    panel.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    let clock = 0;
    function touch(type: string, x: number, y: number, target: Element = panel, count = 1) {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      const point = { identifier: 1, clientX: x, clientY: y };
      Object.defineProperties(event, {
        touches: {
          value:
            type === "touchend" || type === "touchcancel"
              ? []
              : Array.from({ length: count }, (_, i) => ({ ...point, identifier: i + 1 })),
        },
        changedTouches: { value: [point] },
        timeStamp: { value: (clock += 100) },
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }
    function finish() {
      const event = new dom.window.Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "transform" });
      panel.dispatchEvent(event);
    }
    async function swipe(startX: number, endX: number, endY = 100, target: Element = panel, end = "touchend") {
      await act(async () => {
        touch("touchstart", startX, 100, target);
        touch("touchmove", endX, endY, target);
        touch(end, endX, endY, target);
        finish();
      });
    }
    await swipe(100, 300); // Not the edge.
    await swipe(10, 12, 300); // Vertical scroll.
    await swipe(10, -150); // Wrong direction.
    await swipe(10, 30); // Too short.
    await swipe(10, 200, 100, panel.querySelector("input")!); // Slider.
    await swipe(10, 200, 100, panel.querySelector("#nested")!); // Nested dialog.
    await swipe(10, 200, 100, panel, "touchcancel");
    expect(backs).toBe(0);
    expect(panel.style.transform).toBe("");
    await act(async () => {
      touch("touchstart", 10, 100);
      touch("touchmove", 150, 100);
      touch("touchstart", 150, 100, panel, 2);
      finish();
      touch("touchend", 200, 100);
    });
    expect(backs).toBe(0);
    expect(panel.style.transform).toBe("");

    await swipe(10, 200);
    expect(backs).toBe(1);
    expect(panel.dataset.page).toBe("list");
    expect(panel.dataset.open).toBe("true");
    expect(panel.style.opacity).toBe("");
    expect(panel.style.transform).toBe("");
    await swipe(10, 200);
    expect(backs).toBe(2);
    expect(panel.dataset.open).toBe("false");
    await swipe(10, 200);
    expect(backs).toBe(2); // Closed surfaces cannot consume gestures.

    await act(async () => reset(1));
    reducedMotion = true;
    await swipe(10, 200);
    expect(backs).toBe(3);
    expect(panel.dataset.page).toBe("list");
    reducedMotion = false;
    await act(async () => {
      touch("touchstart", 10, 100);
      touch("touchmove", 200, 100);
      touch("touchend", 200, 100);
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    expect(backs).toBe(4); // Missing transitionend cannot strand the page.
    await act(async () => reset(1));
    await act(async () => {
      touch("touchstart", 10, 100);
      touch("touchmove", 200, 100);
      touch("touchend", 200, 100);
      enabled = false;
      root.render(createElement(Harness));
    });
    await act(async () => {
      finish();
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    expect(backs).toBe(4); // Navigating away cancels the pending callback.
    expect(panel.style.transform).toBe("");

    // Existing reader panels still accept ordinary drags toward either exit.
    enabled = true;
    edgeOnly = false;
    await act(async () => root.render(createElement(Harness)));
    await swipe(100, 300);
    expect(backs).toBe(5);
    exit = "left";
    await act(async () => reset(1));
    await swipe(300, 100);
    expect(backs).toBe(6);
    await act(async () => reset(1));
    await swipe(10, 200); // Left-exiting reader sheets also accept iOS edge back.
    expect(backs).toBe(7);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
