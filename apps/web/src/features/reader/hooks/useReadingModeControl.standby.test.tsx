import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useReadingModeControl } from "./useReadingModeControl";
import { readTextUnitModeState, textUnitModeStateKey } from "../lib/text-unit-mode-state";

test("a standing reader keeps the book's mode as it was stored: nothing is written, and the mode is not switched off", async () => {
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
  const bookId = "standing-mode-test";
  const key = textUnitModeStateKey(bookId);
  // The book was left in a unit-by-unit mode, resting on a sentence.
  const stored = JSON.stringify({
    active: true,
    modeKey: "standing:reader",
    unitId: "sentence",
    contentVersion: "sha256:abc",
    resting: { cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:20)", progress: null },
  });
  dom.window.localStorage.setItem(key, stored);
  const writes: string[] = [];
  const storage = dom.window.Storage.prototype;
  const setItem = storage.setItem,
    removeItem = storage.removeItem;
  storage.setItem = function (name: string, value: string) {
    if (name === key) writes.push(value);
    return setItem.call(this, name, value);
  };
  storage.removeItem = function (name: string) {
    if (name === key) writes.push("(removed)");
    return removeItem.call(this, name);
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useReadingModeControl>;
  function Harness({ reading }: { reading: boolean }) {
    state = useReadingModeControl(bookId, true, reading);
    return null;
  }
  try {
    await act(async () => {
      root.render(<Harness reading={false} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The request is the stored one, so the reader shows the mode as suspended, not off.
    expect(state.request.active).toBe(true);
    expect(state.request.modeKey).toBe("standing:reader");
    expect(writes).toEqual([]);
    expect(readTextUnitModeState(bookId)).toMatchObject({ active: true, modeKey: "standing:reader" });
    const standing = state.controller;

    // Reading starts: a controller for that session, from what is stored now.
    await act(async () => {
      root.render(<Harness reading />);
    });
    expect(state.controller).not.toBe(standing);
    expect(state.request.active).toBe(true);

    // Reading ends: back to standing, with the mode still the book's.
    await act(async () => {
      root.render(<Harness reading={false} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(state.request.active).toBe(true);
    expect(readTextUnitModeState(bookId)).toMatchObject({ active: true, modeKey: "standing:reader" });
  } finally {
    await act(async () => {
      root.unmount();
    });
    storage.setItem = setItem;
    storage.removeItem = removeItem;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
