import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { normalizeBookIdParam, resolveBookId } from "./current-book";

describe("normalizeBookIdParam", () => {
  test("maps current-book aliases to undefined and keeps real ids", () => {
    expect(normalizeBookIdParam(undefined)).toBeUndefined();
    expect(normalizeBookIdParam("  ")).toBeUndefined();
    expect(normalizeBookIdParam("current")).toBeUndefined();
    expect(normalizeBookIdParam("Current")).toBeUndefined();
    expect(normalizeBookIdParam("this-book")).toBeUndefined();
    expect(normalizeBookIdParam("book-42")).toBe("book-42");
    expect(normalizeBookIdParam(" book-42 ")).toBe("book-42");
  });
});

describe("resolveBookId", () => {
  const bookScope = { kind: "book", bookId: "book-1" as Id } as const;
  const globalScope = { kind: "global", threadId: "t1" } as const;

  test("aliases resolve to the scoped current book", () => {
    expect(resolveBookId(bookScope, "current")).toBe("book-1" as Id);
    expect(resolveBookId(bookScope, undefined)).toBe("book-1" as Id);
    expect(resolveBookId(bookScope, "book-9")).toBe("book-9" as Id);
  });

  test("global thread still requires a real id", () => {
    expect(() => resolveBookId(globalScope, "current")).toThrow("bookId is required");
    expect(() => resolveBookId(globalScope, undefined)).toThrow("bookId is required");
    expect(resolveBookId(globalScope, "book-9")).toBe("book-9" as Id);
  });
});
