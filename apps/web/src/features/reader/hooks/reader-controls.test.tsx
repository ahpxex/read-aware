import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useReaderControls } from "./useReaderControls";

test("React acknowledges the actual DOM commit and observes local UI intents", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useReaderControls>;
  function Harness() {
    state = useReaderControls();
    return <header inert={!state.visible} data-visible={state.visible}>Reader controls</header>;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    let pending!: Promise<unknown>;
    let settled = false;
    await act(async () => {
      pending = state.controls.setVisible(true).then(value => {
        expect(dom.window.document.querySelector("header")!.getAttribute("data-visible")).toBe("true");
        expect(dom.window.document.querySelector("header")!.hasAttribute("inert")).toBe(false);
        settled = true; return value;
      });
      expect(settled).toBe(false);
    });
    await pending; expect(settled).toBe(true);
    await act(async () => { state.setVisible(false); });
    expect(state.controls.snapshot()).toEqual({ visible: false });
    expect(dom.window.document.querySelector("header")!.hasAttribute("inert")).toBe(true);
    await act(async () => {
      pending = state.controls.setVisible(true).catch(error => error);
      root.unmount();
    });
    expect(await pending).toMatchObject({ code: "reader/superseded" });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
