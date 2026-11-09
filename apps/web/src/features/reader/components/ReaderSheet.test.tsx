import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReaderSheet } from "./ReaderSheet";

test("a sheet closed by a gesture stays out of view; a tap close still collapses", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: false }) });

  let closes = 0;
  let open!: () => void;
  function Harness() {
    const [active, setActive] = useState<"contents" | null>("contents");
    open = () => setActive("contents");
    return createElement(ReaderSheet<"contents">, {
      active,
      render: () => ({ title: "Contents", tall: true, body: createElement("p", { id: "body" }, "Chapter one") }),
      onClose: () => {
        closes++;
        setActive(null);
      },
    });
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(createElement(Harness)));
    const doc = dom.window.document;
    const sheet = doc.querySelector<HTMLElement>("[role=dialog]")!;
    const grow = sheet.firstElementChild as HTMLElement;
    sheet.getBoundingClientRect = () => ({ width: 400, height: 600 }) as DOMRect;
    grow.getBoundingClientRect = () => ({ width: 400, height: 600 }) as DOMRect;
    const body = () => doc.getElementById("body");

    let clock = 0;
    function touch(type: string, x: number, y: number) {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      const point = { identifier: 1, clientX: x, clientY: y };
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [point] },
        changedTouches: { value: [point] },
        timeStamp: { value: (clock += 100) },
      });
      body()!.dispatchEvent(event);
    }
    function transitionEnd(target: Element, propertyName: string) {
      const event = new dom.window.Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: propertyName });
      target.dispatchEvent(event);
    }

    // Pulled down and released: the zero height it was dragged to holds once
    // the close commits (and its effects run), rather than springing back to
    // full height to collapse a second time.
    await act(async () => {
      touch("touchstart", 200, 100);
      touch("touchmove", 200, 400);
      touch("touchend", 200, 400);
      transitionEnd(grow, "height");
    });
    expect(closes).toBe(1);
    expect(grow.style.height).toBe("0px");
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    expect(body()).toBeNull(); // No collapse is left to wait for.

    // Reopened: the open class owns the size again.
    await act(async () => open());
    expect(grow.style.height).toBe("");
    expect(grow.classList.contains("transition-none")).toBe(false);
    expect(body()).not.toBeNull();

    // Swiped away to the left: the swipe reaches the sheet (its own dialog),
    // and the close lands collapsed, with no collapse replayed in view.
    await act(async () => {
      touch("touchstart", 300, 200);
      touch("touchmove", 100, 200);
      touch("touchend", 100, 200);
      transitionEnd(sheet, "transform");
    });
    expect(closes).toBe(2);
    expect(sheet.style.transform).toBe("");
    expect(grow.classList.contains("transition-none")).toBe(true);
    expect(grow.classList.contains("grid-rows-[0fr]")).toBe(true);
    expect(body()).toBeNull();

    // Closed by a tap beside it: the collapse runs, painting the content
    // until it ends.
    await act(async () => open());
    await act(async () => (sheet.previousElementSibling as HTMLElement).click());
    expect(closes).toBe(3);
    expect(grow.classList.contains("transition-none")).toBe(false);
    expect(body()).not.toBeNull();
    await act(async () => transitionEnd(grow, "grid-template-rows"));
    expect(body()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
