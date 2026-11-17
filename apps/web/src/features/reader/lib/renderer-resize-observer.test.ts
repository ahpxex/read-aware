import { expect, test } from "bun:test";
import { RendererResizeObserver } from "../../../../foliate-js/src/resize-observer";

test("a size change re-renders in the observer callback, with the content's current context", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let notify = () => {};
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  const element = { clientWidth: 900, clientHeight: 700 };
  const context = {};
  const rendered: Array<object | undefined> = [];
  const observer = new RendererResizeObserver(
    () => context,
    (source) => rendered.push(source),
  );
  try {
    observer.observe(element as unknown as HTMLElement);
    notify();
    expect(rendered).toEqual([]);
    element.clientWidth = 500;
    notify();
    expect(rendered).toEqual([context]);
    notify();
    expect(rendered).toHaveLength(1);
    observer.disconnect();
    element.clientWidth = 400;
    notify();
    expect(rendered).toHaveLength(1);
  } finally {
    observer.disconnect();
    if (saved) Object.defineProperty(globalThis, "ResizeObserver", saved);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
});
