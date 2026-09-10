import { expect, spyOn, test } from "bun:test";
import { searchChapters, searchChaptersAsync, type ChapterLike } from "./text-search";

test("cooperative chapter search preserves ranking, dedupe, fallback, snippets and limits", async () => {
  const chapters = [
    { title: "First", text: "alpha and beta" },
    { title: "Second", text: "alpha beta" + "x".repeat(300) + "alpha beta" },
    { title: "Third", text: "alpha something gamma" },
    { title: "Boundary", text: "x".repeat(32767) + "needle" + "x".repeat(33000) + "needle" },
  ];
  for (const queries of [["alpha beta"], ["alpha beta", "alpha"], ["alpha beta gamma delta"], ["needle"], [""], ["missing"]]) {
    for (const limit of [0, 1, 16]) {
      expect(await searchChaptersAsync(chapters, queries, limit)).toEqual(searchChapters(chapters, queries, limit));
    }
  }
  expect((await searchChaptersAsync(chapters, ["alpha beta"])).map(hit => [hit.chapterIndex, hit.match])).toEqual([[1, "exact"], [1, "exact"]]);
  expect((await searchChaptersAsync(chapters, ["needle"])).map(hit => hit.offset)).toEqual([32767, 65773]);
  expect(await searchChaptersAsync([chapters[0]], ["alpha beta"])).toMatchObject([{ match: "partial", offset: 0 }]);
});

test("timer cancellation interrupts a no-match chapter before later chapters are accessed", async () => {
  let time = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => time += 1);
  const controller = new AbortController();
  let reads = 0, firstReads = 0;
  const text = "x".repeat(1000000);
  const chapters: ChapterLike[] = [
    { get text() { firstReads++; return text; } },
    { get text() { reads++; return "needle"; } },
  ];
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await expect(searchChaptersAsync(chapters, ["needle"], 16, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(0);
    expect(firstReads).toBeGreaterThan(0);
    expect(await searchChaptersAsync([{ text: "needle" }], ["needle"])).toHaveLength(1);
  } finally { clearTimeout(timer); clock.mockRestore(); }
});

test("pre-cancelled chapter search never inspects input", async () => {
  const chapters: ChapterLike[] = [{ get text(): string { throw new Error("must not read"); } }];
  await expect(searchChaptersAsync(chapters, ["needle"], 16, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
});
