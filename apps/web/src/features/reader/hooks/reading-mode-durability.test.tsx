import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReadingModeControl } from "./useReadingModeControl";
import { registerReaderModeContribution } from "../../plugins/state/plugin-store";
import { sentenceReaderCopy, sentenceReaderUnits } from "../../../../../../plugins/sentence-reader/src/copy";
import { flushLocalKV, localKV, onLocalKVCommit, type KVCommit } from "../../../platform/local-store";
import { readTextUnitModeSettings } from "../lib/text-unit-mode-state";
import { actorCause, eventCause, reactionActor, stampEventCause } from "../../../platform/domain-actor";

const bookId = "mode-durability-test";
const bookKey = `read-aware-navigator-state:${bookId}`;
const settingsKey = "read-aware-plugin.mode-durability.settings";
const modeKey = "mode-durability:reader";
const legacyKey = "read-aware-navigator-prefs";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Native detection and Jotai's module-lifetime subscriptions stay in a child process.
if (process.env.MODE_DURABILITY_CASE === "1") {
  let dom: JSDOM, root: Root, state: ReturnType<typeof useReadingModeControl>;
  let globals: Map<string, PropertyDescriptor | undefined>;
  let contribution: ReturnType<typeof registerReaderModeContribution>;
  let hold = false;
  let feedbackEnabled = true;
  let second: ReturnType<typeof registerReaderModeContribution>;
  const disk = new Map<string, string>();
  const pending: { entries: [string, string | null][]; commit(): void; reject(error: unknown): void }[] = [];
  function Harness() {
    const control = useReadingModeControl(bookId, true);
    state = control;
    const { controller, request } = control;
    useEffect(() => {
      if (feedbackEnabled)
        controller.feedback(request.revision, request.modeKey, request.unitId, {
          status: request.active ? "ready" : "inactive",
          cfiRange: null,
          progress: null,
        });
    }, [controller, request]);
    return null;
  }
  beforeEach(async () => {
    dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      localStorage: dom.window.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    Object.assign(dom.window, {
      __TAURI_INTERNALS__: {
        invoke(command: string, args: { key: string; value: string; entries: [string, string | null][] }) {
          if (!["set_kv", "delete_kv", "set_kv_batch"].includes(command)) return Promise.resolve();
          const entries: [string, string | null][] =
            command === "set_kv_batch" ? args.entries : [[args.key, command === "delete_kv" ? null : args.value]];
          return new Promise<void>((resolve, reject) => {
            const commit = () => {
              for (const [key, value] of entries) {
                if (value === null) disk.delete(key);
                else disk.set(key, value);
              }
              resolve();
            };
            if (hold) pending.push({ entries, commit, reject });
            else commit();
          });
        },
      },
    });
    hold = false;
    feedbackEnabled = true;
    await localKV.removeItemAsync(legacyKey);
    await localKV.setItemAsync(settingsKey, JSON.stringify({ unitId: "sentence", tapToAdvance: false }));
    await localKV.setItemAsync(
      bookKey,
      JSON.stringify({ active: false, resting: null, modeKey, unitId: "sentence", contentVersion: "v1" }),
    );
    contribution = registerReaderModeContribution({
      id: "reader",
      key: modeKey,
      pluginId: "mode-durability",
      pluginName: "Durability",
      kind: "text-unit-navigator",
      defaultUnitId: "sentence",
      units: sentenceReaderUnits,
      copy: sentenceReaderCopy,
      segmentText: ({ text }) => [{ start: 0, end: text.length }],
    });
    await localKV.setItemAsync(
      "read-aware-plugin.mode-second.settings",
      JSON.stringify({ unitId: "sentence", tapToAdvance: false }),
    );
    second = registerReaderModeContribution({
      id: "reader",
      key: "mode-second:reader",
      pluginId: "mode-second",
      pluginName: "Second",
      kind: "text-unit-navigator",
      defaultUnitId: "sentence",
      units: sentenceReaderUnits,
      copy: sentenceReaderCopy,
      segmentText: ({ text }) => [{ start: 0, end: text.length }],
    });
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<Harness />);
      await tick();
    });
    await flushLocalKV();
    hold = true;
  });
  afterEach(async () => {
    hold = false;
    await act(async () => {
      for (const write of pending.splice(0)) write.commit();
      await tick();
      root.unmount();
      contribution.dispose();
      second.dispose();
      await flushLocalKV();
    });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  test("real mode hook settles on the book-state receipt, then records the confirmed unit preference", async () => {
    const actor = reactionActor("plugin:mode-client", "on-change", eventCause(stampEventCause({}))!);
    const commits: KVCommit[] = [];
    const stop = onLocalKVCommit((commit) => {
      if (commit.entries.some((entry) => entry.key === bookKey)) commits.push(commit);
    });
    try {
      let completed = false;
      let result!: Promise<unknown>;
      await act(async () => {
        result = state.controller.configure({ active: true, unitId: "paragraph" }, undefined, actor).then((value) => {
          completed = true;
          return value;
        });
        await tick();
      });
      // The request writes the book's state; the plugin preference waits for confirmation.
      expect(pending).toHaveLength(1);
      expect(pending[0].entries.map(([key]) => key)).toEqual([bookKey]);
      expect(state.snapshot.status).toBe("ready");
      expect(state.request.origin).toBe(actor);
      expect(eventCause(state.snapshot)).toBe(actorCause(actor));
      expect(completed).toBe(false);
      expect(JSON.parse(disk.get(bookKey)!).active).toBe(false);
      await act(async () => {
        pending.shift()!.commit();
        await result;
        await tick();
      });
      expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ active: true, unitId: "paragraph" });
      expect(eventCause(commits.at(-1)!)).toBe(actorCause(actor));
      expect(commits.at(-1)?.actor).toBe("plugin:mode-client");
      expect(disk.get(bookKey)).not.toContain("on-change");
      expect(pending[0].entries.map(([key]) => key)).toEqual([settingsKey]);
      await act(async () => {
        pending.shift()!.commit();
        await tick();
      });
      expect(JSON.parse(disk.get(settingsKey)!)).toEqual({ unitId: "paragraph", tapToAdvance: false });
    } finally {
      stop();
    }
  });
  test("a failed book-state write rejects with its error and restores the old mode; the preference is untouched", async () => {
    let result!: Promise<unknown>;
    let positionWrites = 0;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" }).catch((error) => error);
      state.controller.persistPosition(state.controller.generation(), modeKey, "paragraph", async () => {
        positionWrites++;
      });
      await tick();
    });
    expect(readTextUnitModeSettings(modeKey).unitId).toBe("sentence");
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
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
  });
  test("external unit edits change the mode only after commit and retain the external cause", async () => {
    const actor = reactionActor("plugin:preferences", "set-unit", eventCause(stampEventCause({}))!);
    let request!: Promise<unknown>;
    await act(async () => {
      request = localKV
        .setItemAsync(settingsKey, JSON.stringify({ unitId: "paragraph" }), actor)
        .catch((error) => error);
      await tick();
    });
    expect(state.request.unitId).toBe("sentence");
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "external preference failed" });
      expect(await request).toMatchObject({ code: "db/locked" });
      await tick();
    });
    expect(state.request.unitId).toBe("sentence");
    hold = false;
    await act(async () => {
      await localKV.setItemAsync(settingsKey, JSON.stringify({ unitId: "paragraph" }), actor);
      await tick();
      await flushLocalKV();
    });
    expect(state.request.unitId).toBe("paragraph");
    expect(actorCause(state.request.origin)).toBe(actorCause(actor));
    expect(eventCause(state.snapshot)).toBe(actorCause(actor));
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ unitId: "paragraph" });
  });

  test("the confirmed unit preference consumes the legacy settings in one write", async () => {
    const legacy = JSON.stringify({ modeKey, unitId: "paragraph", scrollToStep: true });
    hold = false;
    await localKV.setItemAsync(legacyKey, legacy);
    hold = true;
    let result!: Promise<unknown>;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" });
      await tick();
      pending.shift()!.commit();
      await result;
      await tick();
    });
    // The legacy preference already says paragraph, so there is nothing new to
    // record unless it still has to be migrated; then it moves in one batch.
    if (pending.length) {
      expect(pending[0].entries.map(([key]) => key).sort()).toEqual([settingsKey, legacyKey].sort());
      expect(pending[0].entries).toContainEqual([legacyKey, null]);
      await act(async () => {
        pending.shift()!.commit();
        await tick();
      });
      expect(disk.has(legacyKey)).toBe(false);
      expect(JSON.parse(disk.get(settingsKey)!)).toMatchObject({ unitId: "paragraph", scrollToStep: true });
    }
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ active: true, unitId: "paragraph" });
  });
  test("a cancelled cross-provider switch never touches the destination's preference", async () => {
    feedbackEnabled = false;
    const owner = new AbortController();
    let result!: Promise<unknown>;
    await act(async () => {
      result = state.controller
        .configure({ active: true, selectModeKey: "mode-second:reader", unitId: "paragraph" }, owner.signal)
        .catch((error) => error);
      await tick();
      owner.abort(new Error("cancel switch"));
      await result;
      for (const write of pending.splice(0)) write.commit();
      await tick();
      for (const write of pending.splice(0)) write.commit();
      await tick();
    });
    const secondKey = "read-aware-plugin.mode-second.settings";
    expect(JSON.parse(disk.get(secondKey)!)).toEqual({ unitId: "sentence", tapToAdvance: false });
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ modeKey, active: false });
  });
  test("later settings ownership survives cancellation compensation", async () => {
    feedbackEnabled = false;
    const owner = new AbortController();
    let result!: Promise<unknown>;
    const secondKey = "read-aware-plugin.mode-second.settings";
    await act(async () => {
      result = state.controller
        .configure({ active: true, selectModeKey: "mode-second:reader", unitId: "paragraph" }, owner.signal)
        .catch((error) => error);
      await tick();
      pending.shift()!.commit();
      await tick();
      void localKV.setItemAsync(secondKey, JSON.stringify({ unitId: "paragraph", tapToAdvance: true }));
      owner.abort(new Error("cancel switch"));
      await result;
      pending.shift()!.commit();
      await tick();
      pending.shift()!.commit();
      await tick();
    });
    expect(JSON.parse(disk.get(secondKey)!)).toEqual({ unitId: "paragraph", tapToAdvance: true });
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ modeKey, active: false });
  });

  test("late persistence after cancellation cannot dispatch an obsolete position write", async () => {
    const abort = new AbortController();
    let result!: Promise<unknown>;
    let positionWrites = 0;
    await act(async () => {
      result = state.controller.configure({ active: true, unitId: "paragraph" }, abort.signal).catch((error) => error);
      state.controller.persistPosition(state.controller.generation(), modeKey, "paragraph", async () => {
        positionWrites++;
      });
      await tick();
      abort.abort(new Error("owner closed"));
      await result;
      pending.shift()!.commit();
      await tick();
    });
    expect(positionWrites).toBe(0);
    expect(state.request).toMatchObject({ active: false, unitId: "sentence" });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    expect(JSON.parse(disk.get(bookKey)!)).toMatchObject({ active: false, unitId: "sentence" });
    expect(JSON.parse(disk.get(settingsKey)!).unitId).toBe("sentence");
  });
} else {
  test("isolated React/native mode durability cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, MODE_DURABILITY_CASE: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("7 pass");
  }, 30_000);
}
