import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { localKV } from "../../../platform/local-store";
import { parseTocPins, tocFoldsKey, tocFoldsStore, writeTocPins } from "./toc-folds";

// localKV falls back to localStorage outside Tauri; give it a real one for
// this file only, and hand the global back untouched for the next file.
const dom = new JSDOM("", { url: "http://localhost/" });
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: dom.window.localStorage,
  });
});
afterEach(() => localStorage.clear());
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("pins parse tolerantly", () => {
  expect([...parseTocPins(JSON.stringify({ pinned: ["1", 2, "3"] }))]).toEqual(["1", "3"]);
  expect(parseTocPins(null).size).toBe(0);
  expect(parseTocPins("{").size).toBe(0);
  expect(parseTocPins(JSON.stringify({ pinned: "1" })).size).toBe(0);
  expect(parseTocPins(JSON.stringify(null)).size).toBe(0);
});

test("pins are stored per book, pruned to live branches, and cleared when empty", async () => {
  const seen: string[] = [];
  const stop = tocFoldsStore.subscribe("book-a", () => seen.push(tocFoldsStore.read("book-a") ?? "<none>"));
  await writeTocPins("book-a", ["v1", "gone", "v2"], new Set(["v1", "v2"]));
  expect(JSON.parse(localKV.getItem(tocFoldsKey("book-a"))!)).toEqual({ pinned: ["v1", "v2"] });
  expect(tocFoldsStore.read("book-b")).toBeNull();

  await writeTocPins("book-b", ["v1"], new Set(["v1"]));
  await writeTocPins("book-a", ["gone"], new Set(["v1", "v2"]));
  expect(localKV.getItem(tocFoldsKey("book-a"))).toBeNull();
  // Another book's write does not wake this book's subscribers.
  expect(seen).toEqual(['{"pinned":["v1","v2"]}', "<none>"]);
  stop();
});
