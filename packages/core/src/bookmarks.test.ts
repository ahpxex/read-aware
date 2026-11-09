import { expect, test } from "bun:test";
import { bookmarkLocation, bookmarkTargetFrom, normalizeBookmarkName, normalizeBookmarkTarget } from "./bookmarks";

test("names are trimmed, single-line and bounded", () => {
  expect(normalizeBookmarkName("  a\n  b ")).toBe("a b");
  expect(normalizeBookmarkName(" ")).toBeNull();
  expect(normalizeBookmarkName("x".repeat(121))).toBeNull();
  expect(normalizeBookmarkName(3)).toBeNull();
});

test("targets hold exactly one locator, and a selection holds a CFI", () => {
  expect(normalizeBookmarkTarget({ contentVersion: "v", href: "a.xhtml", bookId: "b" }, "location")).toEqual({
    contentVersion: "v",
    href: "a.xhtml",
  });
  expect(normalizeBookmarkTarget({ contentVersion: "v", href: "a", cfi: "epubcfi(/6)" }, "location")).toBeNull();
  expect(normalizeBookmarkTarget({ contentVersion: "v", fraction: 2 }, "location")).toBeNull();
  expect(normalizeBookmarkTarget({ contentVersion: "v", href: "a" }, "selection")).toBeNull();
  expect(normalizeBookmarkTarget({ href: "a" }, "location")).toBeNull();
  expect(
    normalizeBookmarkTarget({ contentVersion: "v", cfi: "epubcfi(/6)", textQuote: { exact: "" } }, "selection"),
  ).toBeNull();
});

test("a session location keeps its most precise locator", () => {
  const location = { bookId: "b", contentVersion: "v", cfi: "epubcfi(/6/2)", href: "a.xhtml", fraction: 0.3 };
  const target = bookmarkTargetFrom(location, "location");
  expect(target).toEqual({ contentVersion: "v", cfi: "epubcfi(/6/2)" });
  expect(bookmarkTargetFrom({ bookId: "b", contentVersion: "v", fraction: 0.3 }, "location")).toEqual({
    contentVersion: "v",
    fraction: 0.3,
  });
  expect(() => bookmarkTargetFrom({ bookId: "b", contentVersion: "v", href: "a" }, "selection")).toThrow();
  expect(bookmarkLocation({ bookId: "b", target })).toEqual({ bookId: "b", contentVersion: "v", cfi: "epubcfi(/6/2)" });
});
