import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useReadingModeControl } from "./useReadingModeControl";
import { registerReaderModeContribution } from "../../plugins/state/plugin-store";
import {
  readTextUnitModeState,
  writeTextUnitModeState,
  readTextUnitModeSettings,
  updateTextUnitModeSettings,
} from "../lib/text-unit-mode-state";
import { readingRuntime } from "../../../domain/reading-runtime";
import { flushLocalKV } from "../../../platform/local-store";
import { sentenceReaderCopy, sentenceReaderUnits } from "../../../../../../plugins/sentence-reader/src/copy";
import {
  actorCause,
  eventCause,
  reactionActor,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";

test("provider replacement and external preferences converge without replaying an obsolete render", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useReadingModeControl>;
  let renders = 0;
  function Harness() {
    state = useReadingModeControl("mode-owner-test", true);
    if (++renders > 80) throw new Error("Mode preferences did not converge");
    return null;
  }
  const segmentText = ({ text }: { text: string }) => [{ start: 0, end: text.length }];
  const register = (pluginId: string, source?: DomainActor) =>
    registerReaderModeContribution(
      {
        id: "reader",
        key: `${pluginId}:reader`,
        pluginId,
        pluginName: pluginId,
        kind: "text-unit-navigator",
        defaultUnitId: "sentence",
        units: sentenceReaderUnits,
        copy: sentenceReaderCopy,
        segmentText,
      },
      source,
    );
  let off: ReturnType<typeof register> | undefined;
  try {
    const id = readingRuntime.begin("mode-owner-test");
    const location = { bookId: "mode-owner-test", contentVersion: "v1", cfi: "first" };
    const detachEngine = readingRuntime.attach(
      id,
      { navigate: async () => location, step: async () => location },
      location,
    );
    void updateTextUnitModeSettings("mode-owner-a:reader", { unitId: "paragraph" });
    const removalActor = reactionActor("plugin:mode-owner", "remove-provider", eventCause(stampEventCause({}))!);
    off = register("mode-owner-a", removalActor);
    await act(async () => {
      root.render(<Harness />);
    });
    expect(state.request.unitId).toBe("paragraph");
    const query = {
      operation: "reading.mode.configure" as const,
      bookId: "mode-owner-test",
      sessionId: id,
      active: true,
    };
    expect(readingRuntime.operationAvailability(query).conditions).toContainEqual({
      kind: "provider",
      state: "satisfied",
      reason: "mode-provider-registered",
    });
    await act(async () => {
      off?.dispose();
      off = undefined;
    });
    expect(state.controller.snapshot().unavailableReason).toBe("no-provider");
    expect(readingRuntime.operationAvailability(query).conditions).toContainEqual({
      kind: "provider",
      state: "unconfigured",
      reason: "no-provider",
      errorCode: "reader/unavailable",
    });
    expect(eventCause(readingRuntime.snapshot())).toBe(actorCause(removalActor));
    void updateTextUnitModeSettings("mode-owner-b:reader", { unitId: "sentence" });
    await act(async () => {
      off = register("mode-owner-b");
    });
    expect(state.request.modeKey).toBe("mode-owner-a:reader");
    expect(state.snapshot.unavailableReason).toBe("no-provider");
    expect(state.snapshot.availableModes.map((mode) => mode.key)).toEqual(["mode-owner-b:reader"]);
    let selection!: Promise<unknown>;
    await act(async () => {
      selection = state.controller.configure({ active: false, selectModeKey: "mode-owner-b:reader" });
    });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, {
        status: "inactive",
        progress: null,
        cfiRange: null,
      });
      await selection;
    });
    expect(state.request.unitId).toBe("sentence");
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
    let other!: ReturnType<typeof register>;
    await act(async () => {
      other = register("mode-owner-c");
    });
    await act(async () => {
      selection = state.controller.configure({
        active: false,
        selectModeKey: "mode-owner-c:reader",
        unitId: "paragraph",
      });
    });
    expect(state.request).toMatchObject({ modeKey: "mode-owner-c:reader", unitId: "paragraph" });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, {
        status: "inactive",
        progress: null,
        cfiRange: null,
      });
      await selection;
      other.dispose();
    });
    await act(async () => {
      selection = state.controller.configure({ active: false, selectModeKey: "mode-owner-b:reader" });
    });
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, {
        status: "inactive",
        progress: null,
        cfiRange: null,
      });
      await selection;
    });
    const replacementActor = reactionActor("plugin:mode-owner", "replace-provider", eventCause(stampEventCause({}))!);
    const beforeReplacement = state.request;
    await act(async () => {
      const previous = off;
      off = register("mode-owner-b", replacementActor);
      previous?.dispose();
      const unrelated = register("mode-owner-unrelated");
      unrelated.dispose();
    });
    expect(state.request.revision).toBeGreaterThan(beforeReplacement.revision);
    expect(actorCause(state.request.origin)).toBe(actorCause(replacementActor));
    expect(eventCause(readingRuntime.snapshot())).toBe(actorCause(replacementActor));
    expect(() =>
      reactionActor("plugin:mode-owner", "replace-provider", eventCause(readingRuntime.snapshot())!),
    ).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
    await act(async () => {
      state.setUnit("paragraph");
    });
    expect(() =>
      reactionActor("plugin:mode-owner", "replace-provider", eventCause(readingRuntime.snapshot())!),
    ).not.toThrow();
    // The unit preference is recorded once the reader confirms the change.
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, {
        status: "inactive",
        progress: null,
        cfiRange: null,
      });
      await flushLocalKV();
    });
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("paragraph");
    const preferenceActor = reactionActor("plugin:preference-client", "update-unit", eventCause(stampEventCause({}))!);
    await act(async () => {
      await updateTextUnitModeSettings("mode-owner-b:reader", { unitId: "sentence" }, preferenceActor);
    });
    expect(state.request.unitId).toBe("sentence");
    expect(actorCause(state.request.origin)).toBe(actorCause(preferenceActor));
    expect(eventCause(readingRuntime.snapshot())).toBe(actorCause(preferenceActor));
    // The reader renders the preferred unit, confirming it.
    await act(async () => {
      state.controller.feedback(state.request.revision, state.request.modeKey, state.request.unitId, {
        status: "inactive",
        progress: null,
        cfiRange: null,
      });
      await flushLocalKV();
    });
    const layoutActor = reactionActor("plugin:layout-client", "switch-layout", eventCause(stampEventCause({}))!);
    await act(async () => {
      detachEngine(layoutActor);
    });
    expect(readingRuntime.snapshot().status).toBe("loading");
    expect(eventCause(readingRuntime.snapshot())).toBe(actorCause(layoutActor));
    await act(async () => {
      readingRuntime.attach(id, { navigate: async () => location, step: async () => location }, location, layoutActor);
    });
    expect(readingRuntime.snapshot().status).toBe("ready");
    expect(eventCause(readingRuntime.snapshot())).toBe(actorCause(layoutActor));
    const abort = new AbortController();
    let work!: Promise<unknown>;
    await act(async () => {
      work = state.controller.configure({ active: true, unitId: "paragraph" }, abort.signal).catch((error) => error);
    });
    expect(state.request.unitId).toBe("paragraph");
    await act(async () => {
      abort.abort(new Error("cancelled"));
      await work;
    });
    expect(state.request).toMatchObject({ active: false, unitId: "sentence" });
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
    await act(async () => {
      work = readingRuntime.configureMode({ active: true, unitId: "paragraph" }).catch((error) => error);
    });
    void writeTextUnitModeState("mode-owner-test", {
      active: true,
      modeKey: "mode-owner-b:reader",
      unitId: "paragraph",
      resting: null,
      contentVersion: "v1",
    });
    await act(async () => {
      readingRuntime.closed();
      await work;
    });
    expect(state.request.active).toBe(false);
    expect(readTextUnitModeState("mode-owner-test").active).toBe(false);
    expect(readTextUnitModeSettings("mode-owner-b:reader").unitId).toBe("sentence");
  } finally {
    await act(async () => {
      readingRuntime.closed();
      root.unmount();
      off?.dispose();
    });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
