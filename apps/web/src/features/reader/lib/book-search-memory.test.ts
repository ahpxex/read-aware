import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { localKV, onLocalKVCommit } from "../../../platform/local-store";
import {
  bookSearchKey,
  createSearchSession,
  parseSearchQuery,
  readSearchQuery,
  writeSearchQuery,
} from "./book-search-memory";

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

test("the remembered query parses tolerantly", () => {
  expect(parseSearchQuery(JSON.stringify({ query: "waxwing" }))).toBe("waxwing");
  expect(parseSearchQuery(null)).toBe("");
  expect(parseSearchQuery("{")).toBe("");
  expect(parseSearchQuery(JSON.stringify({ query: 3 }))).toBe("");
  expect(parseSearchQuery(JSON.stringify(null))).toBe("");
});

test("the query is stored per book, and forgotten when emptied", async () => {
  const writes: string[] = [];
  const stop = onLocalKVCommit((commit) => writes.push(...commit.entries.map((entry) => entry.key)));
  await writeSearchQuery("book-a", "waxwing");
  await writeSearchQuery("book-b", "azure");
  expect(readSearchQuery("book-a")).toBe("waxwing");
  expect(readSearchQuery("book-b")).toBe("azure");
  expect(readSearchQuery("book-c")).toBe("");

  await writeSearchQuery("book-a", "waxwing"); // Unchanged: not written again.
  expect(writes).toEqual([bookSearchKey("book-a"), bookSearchKey("book-b")]);
  stop();

  await writeSearchQuery("book-a", "");
  expect(localKV.getItem(bookSearchKey("book-a"))).toBeNull();
  expect(readSearchQuery("book-b")).toBe("azure");
  await writeSearchQuery("book-a", ""); // Already gone.
  expect(localKV.getItem(bookSearchKey("book-a"))).toBeNull();
});

test("the session remembers results per book and query, and a place only for its query", () => {
  const session = createSearchSession<{ hits: number }>();
  session.results.set("book-a", "waxwing", { hits: 3 });
  expect(session.results.get("book-a", "waxwing")).toEqual({ hits: 3 });
  expect(session.results.get("book-a", "azure")).toBeUndefined();
  expect(session.results.get("book-b", "waxwing")).toBeUndefined();

  session.place.set("book-a", "waxwing", "t:7");
  expect(session.place.get("book-a", "waxwing")).toBe("t:7");
  expect(session.place.get("book-a", "azure")).toBeUndefined();
  session.place.set("book-a", "azure", "t:2"); // One place per book: the latest list.
  expect(session.place.get("book-a", "waxwing")).toBeUndefined();

  const of = (index: number) => `Chapter ${index}`;
  session.chapters.set("book-a", of);
  expect(session.chapters.get("book-a")).toBe(of);
  session.clear();
  expect(session.results.get("book-a", "waxwing")).toBeUndefined();
  expect(session.chapters.get("book-a")).toBeUndefined();
});

test("the session forgets the least recently used results past its size", () => {
  const session = createSearchSession<number>();
  for (let i = 0; i < 12; i++) session.results.set("book", `q${i}`, i);
  expect(session.results.get("book", "q0")).toBe(0); // Touched: now the most recent.
  session.results.set("book", "q12", 12);
  expect(session.results.get("book", "q0")).toBe(0);
  expect(session.results.get("book", "q1")).toBeUndefined();
  expect(session.results.get("book", "q12")).toBe(12);
});
