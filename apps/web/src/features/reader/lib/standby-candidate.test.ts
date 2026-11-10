import { expect, test } from "bun:test";
import type { LibraryBook } from "../../library";
import { standbyCandidate } from "./standby-candidate";

const book = (id: string, lastOpenedAt: string | null, format: LibraryBook["format"] = "epub") =>
  ({ id, lastOpenedAt, format }) as LibraryBook;

test("the book read most recently stands by", () => {
  const books = [
    book("old", "2026-10-01T08:00:00.000Z"),
    book("latest", "2026-11-09T21:30:00.000Z"),
    book("never", null),
    book("middle", "2026-11-01T10:00:00.000Z"),
  ];
  expect(standbyCandidate(books, new Set())?.id).toBe("latest");
});

test("a book already tried, a plugin-provided book and one never opened are passed over", () => {
  const books = [
    book("feed", "2026-11-10T09:00:00.000Z", "virtual"),
    book("failed", "2026-11-09T21:30:00.000Z"),
    book("next", "2026-11-08T21:30:00.000Z"),
    book("never", null),
  ];
  expect(standbyCandidate(books, new Set(["failed"]))?.id).toBe("next");
  expect(standbyCandidate(books, new Set(["failed", "next"]))).toBeNull();
  expect(standbyCandidate([], new Set())).toBeNull();
});
