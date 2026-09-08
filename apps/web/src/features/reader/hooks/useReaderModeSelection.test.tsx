import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { ReadingModeController } from "../lib/reading-mode-controller";
import { readingRuntime } from "../../../domain/reading-runtime";
import { useReaderModeSelection } from "./useReaderModeSelection";

test("the reader owns selection until feedback, even when its last-choice picker disappears", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const mode = new ReadingModeController(false, "unit", 1000, "missing:mode");
  mode.environment({ key: "live:mode", label: "Live", defaultUnitId: "unit", units: [{ id: "unit", label: "Unit" }] }, true);
  let state!: ReturnType<typeof useReaderModeSelection>;
  function Harness({ show }: { show: boolean }) {
    state = useReaderModeSelection("picker-book", mode.snapshot());
    return show ? <button>Provider</button> : null;
  }
  let release: (() => void) | undefined;
  try {
    const id = readingRuntime.begin("picker-book");
    const location = { bookId: "picker-book", contentVersion: "v1", cfi: "first" };
    readingRuntime.attach(id, { navigate: async () => location, step: async () => location }, location);
    release = readingRuntime.bindMode(id, { snapshot: mode.snapshot, observe: mode.observe, generation: mode.generation,
      configure: (input, signal) => mode.configure(input, signal), retire: () => mode.retire(),
      waitForPosition: async () => {}, step: async () => "end-of-book" });
    await act(async () => { root.render(<ToastProvider><Harness show /></ToastProvider>); });
    let work!: Promise<boolean>;
    await act(async () => { work = state.select("live:mode"); });
    expect(state.busy).toBe(true);
    await act(async () => { root.render(<ToastProvider><Harness show={false} /></ToastProvider>); });
    expect(mode.requested().modeKey).toBe("live:mode");
    let result: boolean | undefined;
    await act(async () => {
      mode.feedback(mode.generation(), "live:mode", "unit", { status: "inactive", progress: null, cfiRange: null });
      result = await work;
    });
    expect(result).toBe(true);
    expect(state.busy).toBe(false);
    expect(mode.snapshot()).toMatchObject({ modeKey: "live:mode", status: "inactive" });
  } finally {
    await act(async () => { root.unmount(); release?.(); readingRuntime.closed(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
