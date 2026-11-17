import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { actorOrigin, type DomainActor } from "../../../platform/domain-actor";
import { useReaderViewportResize } from "./useReaderViewportResize";

test("a viewport resize applies the text measure and drops the selection in the observer callback", async () => {
  const dom = new JSDOM("<div id='root'></div><section id='viewport'></section>", { url: "http://localhost" });
  let notify = () => {};
  class ResizeProbe {
    constructor(callback: () => void) {
      notify = callback;
    }
    observe() {}
    disconnect() {}
  }
  const values = {
    window: dom.window,
    document: dom.window.document,
    ResizeObserver: ResizeProbe,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const viewport = dom.window.document.getElementById("viewport")!;
  let width = 900;
  Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, get: () => 700 });
  const calls: Array<[string, DomainActor]> = [];
  const selectionRef = { current: { text: "selected" } as unknown };
  function Harness() {
    useReaderViewportResize({
      viewportRef: { current: viewport },
      selectionRef,
      clearSelection: (origin) => calls.push(["clear", origin]),
      applyMaxInlineSize: (origin) => calls.push(["measure", origin]),
    });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(<Harness />));
    notify();
    expect(calls).toEqual([]);
    width = 600;
    notify();
    expect(calls.map(([kind]) => kind)).toEqual(["clear", "measure"]);
    expect(actorOrigin(calls[0]![1])).toBe("system");
    selectionRef.current = null;
    width = 500;
    notify();
    expect(calls.map(([kind]) => kind)).toEqual(["clear", "measure", "measure"]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
