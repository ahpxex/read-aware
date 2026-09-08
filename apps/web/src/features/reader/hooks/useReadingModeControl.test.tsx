import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useReadingModeControl } from "./useReadingModeControl";
import { registerReaderModeContribution } from "../../plugins/state/plugin-store";
import { readTextUnitModeState, writeTextUnitModeState, readTextUnitModeSettings, updateTextUnitModeSettings } from "../lib/text-unit-mode-state";
import { readingRuntime } from "../../../domain/reading-runtime";
import { sentenceReaderCopy, sentenceReaderUnits } from "../../../../../../plugins/sentence-reader/src/copy";

test("provider replacement and external preferences converge without replaying an obsolete render", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useReadingModeControl>;
  let renders = 0;
  function Harness() {
    state = useReadingModeControl("mode-owner-test", true);
    if (++renders > 80) throw new Error("Mode preferences did not converge");
    return null;
  }
  const register = (pluginId: string) => registerReaderModeContribution({ id: "reader", key: `${pluginId}:reader`, pluginId,
    pluginName: pluginId, kind: "text-unit-navigator", defaultUnitId: "sentence", units: sentenceReaderUnits,
    copy: sentenceReaderCopy, segmentText: ({ text }) => [{ start: 0, end: text.length }] });
  let off: ReturnType<typeof register> | undefined;
  try {
    const id = readingRuntime.begin("mode-owner-test");
    const location = { bookId: "mode-owner-test", contentVersion: "v1", cfi: "first" };
    readingRuntime.attach(id, { navigate: async () => location, step: async () => location }, location);
    updateTextUnitModeSettings("mode-owner-a:reader", { unitId: "paragraph" });
    off = register("mode-owner-a");
    await act(async () => { root.render(<Harness />); });
    expect(state.request.unitId).toBe("paragraph");
    await act(async () => { off?.dispose(); off = undefined; });
    expect(state.controller.snapshot().unavailableReason).toBe("no-provider");
    updateTextUnitModeSettings("mode-owner-b:reader", { unitId: "sentence" });
    await act(async () => { off = register("mode-owner-b"); });
    expect(state.request.modeKey).toBe("mode-owner-a:reader");
    expect(state.snapshot.unavailableReason).toBe("no-provider");
    expect(state.snapshot.availableModes.map(mode => mode.key)).toEqual(["mode-owner-b:reader"]);
    let selection!: Promise<unknown>;
    await act(async () => { selection = state.controller.configure({ active: false, selectModeKey: "mode-owner-b:reader" }); });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, { status: "inactive", progress: null, cfiRange: null });
      await selection;
    });
    expect(state.request.unitId).toBe("sentence");
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
    let other!: ReturnType<typeof register>;
    await act(async () => { other = register("mode-owner-c"); });
    await act(async () => { selection = state.controller.configure({ active: false, selectModeKey: "mode-owner-c:reader", unitId: "paragraph" }); });
    expect(state.request).toMatchObject({ modeKey: "mode-owner-c:reader", unitId: "paragraph" });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, { status: "inactive", progress: null, cfiRange: null });
      await selection;
      other.dispose();
    });
    await act(async () => { selection = state.controller.configure({ active: false, selectModeKey: "mode-owner-b:reader" }); });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, { status: "inactive", progress: null, cfiRange: null });
      await selection;
    });
    await act(async () => { state.setUnit("paragraph"); });
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("paragraph");
    await act(async () => { updateTextUnitModeSettings("mode-owner-b:reader", { unitId: "sentence" }); });
    expect(state.request.unitId).toBe("sentence");
    const abort = new AbortController();
    let work!: Promise<unknown>;
    await act(async () => { work = state.controller.configure({ active: true, unitId: "paragraph" }, abort.signal).catch(error => error); });
    expect(state.request.unitId).toBe("paragraph");
    await act(async () => { abort.abort(new Error("cancelled")); await work; });
    expect(state.request).toMatchObject({ active: false, unitId: "sentence" });
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
    await act(async () => { work = readingRuntime.configureMode({ active: true, unitId: "paragraph" }).catch(error => error); });
    writeTextUnitModeState("mode-owner-test", { active: true, modeKey: "mode-owner-b:reader", unitId: "paragraph", resting: null, contentVersion: "v1" });
    await act(async () => { readingRuntime.closed(); await work; });
    expect(state.request.active).toBe(false);
    expect(readTextUnitModeState("mode-owner-test").active).toBe(false);
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
  } finally {
    await act(async () => { readingRuntime.closed(); root.unmount(); off?.dispose(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
