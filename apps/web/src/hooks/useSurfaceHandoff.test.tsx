import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import type { LibraryBook } from "../features/library/lib/library-types";
import { useSurfaceHandoff } from "./useSurfaceHandoff";

test("surface close joins persistence, shares concurrent callers and cannot tear down a reopened session", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const timers = new Map<number, () => void>();
  let counter = 0, release!: () => void, calls = 0;
  dom.window.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++counter;
    if (delay === 260) timers.set(id, callback);
    return id;
  }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useSurfaceHandoff>;
  let fail = false;
  const reader = { selectedBook: null, readerLoadError: null, currentPage: 0, totalPages: 0,
    openReader() {}, closeReader: async () => {
      calls++;
      await new Promise<void>(resolve => { release = resolve; });
      if (fail) throw new AppError("db/locked", "fixture");
    } };
  function Harness() { state = useSurfaceHandoff(reader); return null; }
  const fade = () => { for (const [id, callback] of timers) { timers.delete(id); callback(); } };
  try {
    await act(async () => { root.render(<Harness />); });
    let pending!: Promise<void>, done = false;
    await act(async () => {
      pending = state.closeBook(); expect(state.closeBook()).toBe(pending);
      void pending.then(() => { done = true; }); fade();
    });
    expect(calls).toBe(1); expect(done).toBe(false);
    await act(async () => { release(); await pending; });
    expect(done).toBe(true);

    await act(async () => { pending = state.closeBook(); fade(); });
    const replaced = pending.catch(error => error);
    await act(async () => { state.openBook({ id: "new" } as LibraryBook); });
    expect(await replaced).toMatchObject({ code: "reader/superseded" });
    await act(async () => { release(); await Promise.resolve(); });
    expect(state.readerExiting).toBe(false);

    fail = true;
    let failure!: Promise<unknown>;
    await act(async () => { failure = state.closeBook().catch(error => error); fade(); release(); });
    expect(await failure).toMatchObject({ code: "db/locked" });
    expect(state.readerExiting).toBe(false);
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
