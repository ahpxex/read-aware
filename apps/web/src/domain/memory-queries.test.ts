import { describe, expect, test } from "bun:test";
import { normalizeMemoryQuery, type MemoryRecord, type ReadingSessionSnapshot } from "@read-aware/core";
import { createMemoryQueries } from "./memory-queries";
import { bookMemoryBoundary } from "./book-memory-boundary";
import { ReadingSessionController } from "./reading-session-controller";

describe("memory public query boundary", () => {
  test("requires explicit bounded scopes and rejects extra authority", () => {
    expect(normalizeMemoryQuery({ scopes: ["user", "user", "book:b"], query: " q " })).toEqual({ scopes: ["user", "book:b"], query: "q", limit: 20 });
    for (const bad of [{ scopes: [] }, { scopes: ["book:"] }, { scopes: ["book: "] }, { scopes: ["all"] }, { scopes: Array(17).fill("user") },
      { scopes: ["user"], limit: 101 }, { scopes: ["user"], limit: 1.1 }, { scopes: ["user"], query: "a".repeat(2001) }, { scopes: ["user"], includeForgotten: true }]) {
      expect(() => normalizeMemoryQuery(bad as never)).toThrow();
    }
  });
  test("copies input and rejects late and retained queries after retirement", async () => {
    const controller = new AbortController(); let release!: (rows: MemoryRecord[]) => void;
    let captured: unknown;
    const api = createMemoryQueries({ search: async query => { captured = query; return new Promise(resolve => { release = resolve; }); }, graph: async () => ({ digests: [], boundary: { kind: "all" } }) }, controller.signal);
    const input = { scopes: ["user"] as const }; const scopes: ("user" | "global")[] = [...input.scopes];
    const pending = api.search({ scopes }); scopes[0] = "global";
    expect(captured).toEqual({ scopes: ["user"], limit: 20 });
    controller.abort(); release([]); await expect(pending).rejects.toMatchObject({ code: "plugin/cancelled" });
    await expect(api.bookGraph("b")).rejects.toMatchObject({ code: "plugin/cancelled" });
    await expect(api.search({ scopes: ["user"] })).rejects.toMatchObject({ code: "plugin/cancelled" });
  });
  test("does not convert native read failure into empty memory", async () => {
    const error = Error("database locked");
    const api = createMemoryQueries({ search: async () => { throw error; }, graph: async () => { throw error; } });
    await expect(api.search({ scopes: ["user"] })).rejects.toBe(error);
    await expect(api.bookGraph("book")).rejects.toBe(error);
    await expect(api.bookGraph("book", { confirmSpoiler: true } as never)).rejects.toMatchObject({ code: "memory/invalid-query" });
  });
  test("live rereading beats later persisted progress; loading or unknown positions fail closed", () => {
    const idle = new ReadingSessionController().snapshot();
    const book = { id: "b", narrativity: "narrative" as const, readingStatus: "reading", progress: { href: "c.xhtml#late" } };
    const chapters = [{ index: 2, hrefs: ["c.xhtml#late"] }, { index: 0, hrefs: ["a.xhtml"] }, { index: 1, hrefs: ["c.xhtml#early"] }];
    expect(bookMemoryBoundary(book, idle, chapters)).toEqual({ kind: "before", chapterIndex: 2 });
    const live: ReadingSessionSnapshot = { ...idle, bookId: "b", status: "ready", location: { bookId: "b", contentVersion: "v", href: "a.xhtml" } };
    expect(bookMemoryBoundary(book, live, chapters)).toEqual({ kind: "before", chapterIndex: 0 });
    expect(bookMemoryBoundary(book, { ...live, status: "loading" }, chapters)).toEqual({ kind: "unknown" });
    expect(bookMemoryBoundary({ ...book, progress: { href: "c.xhtml#unknown" } }, idle, chapters)).toEqual({ kind: "before", chapterIndex: 1 });
    expect(bookMemoryBoundary(book, idle, null)).toEqual({ kind: "unknown" });
    expect(bookMemoryBoundary({ ...book, narrativity: "expository" }, idle, null)).toEqual({ kind: "all" });
    expect(bookMemoryBoundary({ ...book, readingStatus: "finished" }, idle, null)).toEqual({ kind: "all" });
  });
});
