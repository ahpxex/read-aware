import { expect, spyOn, test } from "bun:test";
import { AppError, type BookTextSearch } from "@read-aware/core";
import { searchBookText, type BookTextSearchSource } from "./book-text-search";

function fixture() {
  const calls: string[] = [];
  const chapters = [{ title: "First", text: "alpha and beta are in the first chapter." }, { title: "Second", text: "alpha beta belong to the second chapter." }];
  const source: BookTextSearchSource = {
    list: async () => { calls.push("list"); return [{ id: "cold" }, { id: "a" }, { id: "b" }]; },
    extract: async id => { calls.push(`extract:${id}`); return chapters; },
    persisted: async id => { calls.push(`persisted:${id}`); return id === "cold" ? null : chapters; },
  };
  return { source, calls };
}

test("single-book variants, chapter ceilings and empty safe range share matching", async () => {
  const { source, calls } = fixture();
  const hits = await searchBookText(source, { queries: ["alpha beta", "alpha beta"], bookId: "a" });
  expect(hits.map(hit => [hit.bookId, hit.chapterIndex, hit.match])).toEqual([["a", 1, "exact"]]);
  expect(await searchBookText(source, { queries: ["alpha beta"], bookId: "a", throughChapterIndex: 0 })).toMatchObject([{ chapterIndex: 0, match: "partial" }]);
  expect(await searchBookText(source, { queries: ["alpha"], bookId: "a", throughChapterIndex: -1 })).toEqual([]);
  expect(calls).toEqual(["extract:a", "extract:a", "extract:a"]);
});

test("shelf uses persisted text only, bounds results, and stops further reads", async () => {
  const { source, calls } = fixture();
  expect(await searchBookText(source, { queries: ["alpha"], limit: 1 })).toMatchObject([{ bookId: "a", chapterIndex: 0 }]);
  expect(calls).toEqual(["list", "persisted:cold", "persisted:a"]);
  const all = await searchBookText(source, { queries: ["alpha"], limit: 4 });
  expect(all.map(hit => hit.bookId)).toEqual(["a", "a", "b", "b"]);
});

test("rejects malformed and oversized requests before reading storage", async () => {
  const { source, calls } = fixture();
  for (const input of [null, {}, { queries: [] }, { queries: [" "] }, { queries: [42] }, { queries: Array(13).fill("a") }, { queries: ["a".repeat(1025)] },
    ...[0, -1, 101, 1.5, NaN].map(limit => ({ queries: ["a"], limit })),
    ...[null, "", 42].map(bookId => ({ queries: ["a"], bookId })),
    { queries: ["a"], throughChapterIndex: 0 }, { queries: ["a"], bookId: "b", throughChapterIndex: -2 },
  ]) await expect(searchBookText(source, input as BookTextSearch)).rejects.toMatchObject({ code: "library/invalid-query" });
  expect(calls).toEqual([]);
});

test("read failures are not empty results or partially successful shelf searches", async () => {
  const { source } = fixture();
  const failure = new AppError("db/locked", "injected");
  source.extract = async () => { throw failure; };
  await expect(searchBookText(source, { queries: ["a"], bookId: "a" })).rejects.toBe(failure);
  source.persisted = async id => { if (id === "b") throw failure; return [{ text: "alpha" }]; };
  await expect(searchBookText(source, { queries: ["alpha"] })).rejects.toBe(failure);
});

test("abort before work or during an awaited read rejects without publishing late text", async () => {
  const { source, calls } = fixture();
  await expect(searchBookText(source, { queries: ["a"] }, AbortSignal.abort())).rejects.toMatchObject({ code: "library/cancelled" });
  expect(calls).toEqual([]);
  const controller = new AbortController();
  source.persisted = async () => { controller.abort(); return [{ text: "alpha" }]; };
  await expect(searchBookText(source, { queries: ["alpha"] }, controller.signal)).rejects.toMatchObject({ code: "library/cancelled" });
});

test("single-book and shelf scans receive cancellation inside matching without starting another read", async () => {
  let time = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => time += 1);
  try {
    for (const bookId of ["a", undefined]) {
      const { source, calls } = fixture();
      source.extract = async () => [{ text: "x".repeat(1000000) }];
      source.persisted = async id => { calls.push(id); return [{ text: "x".repeat(1000000) }]; };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 0);
      try {
        await expect(searchBookText(source, { queries: ["missing"], bookId }, controller.signal)).rejects.toMatchObject({ code: "library/cancelled" });
        expect(calls).toEqual(bookId ? [] : ["list", "cold"]);
      } finally { clearTimeout(timer); }
    }
  } finally { clock.mockRestore(); }
});
