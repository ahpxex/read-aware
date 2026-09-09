import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReadingModeControl } from "./useReadingModeControl";
import { registerReaderModeContribution } from "../../plugins/state/plugin-store";
import { sentenceReaderCopy, sentenceReaderUnits } from "../../../../../../plugins/sentence-reader/src/copy";
import { flushLocalKV, localKV } from "../../../platform/local-store";
import { readTextUnitModeSettings } from "../lib/text-unit-mode-state";

const bookId = "mode-durability-test";
const bookKey = `read-aware-navigator-state:${bookId}`;
const settingsKey = "read-aware-plugin.mode-durability.settings";
const modeKey = "mode-durability:reader";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Native detection and Jotai's module-lifetime subscriptions stay in a child process.
if (process.env.MODE_DURABILITY_CASE === "1") {
  let dom: JSDOM, root: Root, state: ReturnType<typeof useReadingModeControl>;
  let globals: Map<string, PropertyDescriptor | undefined>;
  let contribution: ReturnType<typeof registerReaderModeContribution>;
  let hold = false;
  const disk = new Map<string, string>();
  const pending: { entries: [string, string][]; commit(): void; reject(error: unknown): void }[] = [];
  function Harness() {
    state = useReadingModeControl(bookId, true);
    useEffect(() => {
      state.controller.feedback(state.request.revision, modeKey, state.request.unitId,
        { status: state.request.active ? "ready" : "inactive", cfiRange: null, progress: null });
    }, [state.request]);
    return null;
  }
  beforeEach(async () => {
    dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    Object.assign(dom.window, { __TAURI_INTERNALS__: {
      invoke(command: string, args: { key: string; value: string; entries: [string, string][] }) {
        if (command !== "set_kv" && command !== "set_kv_batch") return Promise.resolve();
        const entries: [string, string][] = command === "set_kv" ? [[args.key, args.value]] : args.entries;
        return new Promise<void>((resolve, reject) => {
          const commit = () => { for (const [key, value] of entries) disk.set(key, value); resolve(); };
          if (hold) pending.push({ entries, commit, reject }); else commit();
        });
      },
    } });
    hold = false;
    await localKV.setItemAsync(settingsKey, JSON.stringify({ unitId: "sentence", tapToAdvance: false }));
    await localKV.setItemAsync(bookKey, JSON.stringify({ active: false, resting: null, modeKey, unitId: "sentence", contentVersion: "v1" }));
    contribution = registerReaderModeContribution({ id: "reader", key: modeKey, pluginId: "mode-durability",
      pluginName: "Durability", kind: "text-unit-navigator", defaultUnitId: "sentence", units: sentenceReaderUnits,
      copy: sentenceReaderCopy, segmentText: ({ text }) => [{ start: 0, end: text.length }] });
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(<Harness />); await tick(); });
    await flushLocalKV();
    hold = true;
  });
  afterEach(async () => {
    hold = false;
    await act(async () => {
      for (const write of pending.splice(0)) write.commit();
      await tick(); root.unmount(); contribution.dispose(); await flushLocalKV();
    });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  test("real mode hook waits for an atomic book/preference receipt after index feedback", async () => {
    let completed = false;
    let result!: Promise<unknown>;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" }).then(value => { completed = true; return value; });
      await tick();
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].entries.map(([key]) => key).sort()).toEqual([bookKey, settingsKey].sort());
    expect(state.snapshot.status).toBe("ready");
    expect(completed).toBe(false);
    expect(JSON.parse(disk.get(bookKey)!).active).toBe(false);
    await act(async () => { pending.shift()!.commit(); await result; });
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ active: true, unitId: "paragraph" });
    expect(JSON.parse(disk.get(settingsKey)!)).toEqual({ unitId: "paragraph", tapToAdvance: false });
  });

  test("a failed optimistic preference is not a new intent; actor gets original error and old mode", async () => {
    let result!: Promise<unknown>;
    let positionWrites = 0;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" }).catch(error => error);
      state.controller.persistPosition(state.controller.generation(), modeKey, "paragraph", async () => { positionWrites++; });
      await tick();
    });
    expect(readTextUnitModeSettings(modeKey).unitId).toBe("paragraph");
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "mode save locked" });
      expect(await result).toMatchObject({ code: "db/locked" });
      await tick();
    });
    expect(state.request).toMatchObject({ active: false, unitId: "sentence" });
    expect(readTextUnitModeSettings(modeKey).unitId).toBe("sentence");
    expect(positionWrites).toBe(0);
    expect(JSON.parse(disk.get(bookKey)!).active).toBe(false);
    expect(JSON.parse(disk.get(settingsKey)!).unitId).toBe("sentence");
    await act(async () => { pending.shift()!.commit(); await tick(); });
  });

  test("late persistence after cancellation cannot dispatch an obsolete position write", async () => {
    const abort = new AbortController();
    let result!: Promise<unknown>;
    let positionWrites = 0;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" }, abort.signal).catch(error => error);
      state.controller.persistPosition(state.controller.generation(), modeKey, "paragraph", async () => { positionWrites++; });
      await tick();
      abort.abort(new Error("owner closed"));
      await result;
      pending.shift()!.commit(); await tick();
    });
    expect(positionWrites).toBe(0);
    expect(state.request).toMatchObject({ active: false, unitId: "sentence" });
    await act(async () => { pending.shift()!.commit(); await tick(); });
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ active: false, unitId: "sentence" });
    expect(JSON.parse(disk.get(settingsKey)!).unitId).toBe("sentence");
  });
} else {
  test("isolated React/native mode durability cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, MODE_DURABILITY_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
