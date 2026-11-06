import { expect, test } from "bun:test";
import cases from "../../../../../../crates/store/src/storage/reading_progress_cases.json";
import { compareReadingProgress, createProgressPatch } from "./library-progress";
import type { LibraryBook, ReaderProgress } from "./library-types";

const progress = (value: object): ReaderProgress => ({
  currentLocation: 0,
  totalLocations: 0,
  progressPercent: 0,
  cfi: null,
  href: null,
  ...value,
});

test("optimistic ordering agrees with native storage fixtures", () => {
  for (const entry of cases) {
    expect(Math.sign(compareReadingProgress(progress(entry.left), progress(entry.right))), entry.name).toBe(
      entry.order,
    );
  }
});

test("optimistic shelf progress follows the latest observation, back or forward", () => {
  const old = progress({
    currentLocation: 300,
    totalLocations: 1000,
    progressPercent: 30,
    cfi: "epubcfi(/6/2!/4/2/1:300)",
  });
  const book = { id: "book", progress: old, progressPercent: 30, readingStatus: "reading" } as LibraryBook;
  const back = createProgressPatch(book, progress({ currentLocation: 200, totalLocations: 1000, progressPercent: 20 }));
  expect(back.progress?.currentLocation).toBe(200);
  expect(back.progressPercent).toBe(20);
  expect(
    createProgressPatch(book, progress({ currentLocation: 301, totalLocations: 1000, progressPercent: 30 })).progress
      ?.currentLocation,
  ).toBe(301);
  const cleared = createProgressPatch(book, null);
  expect(cleared.progress).toBeNull();
  expect(cleared.readingStatus).toBe("unread");
});
