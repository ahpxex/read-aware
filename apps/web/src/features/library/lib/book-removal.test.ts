import { expect, test } from "bun:test";
import { AppError, normalizeBookRemovalIds } from "@read-aware/core";
import { removeBookBatch, releaseRemovedBookFiles } from "./book-removal";

test("batch validates before side effects, copies IDs and deduplicates without coercion", async () => {
  for (const input of [[], null, "book", [false], [" "], Array(1), ["x".repeat(257)], Array(1001).fill("book")]) {
    expect(() => normalizeBookRemovalIds(input)).toThrow();
  }
  const calls: string[] = [], input = ["a", "b", "a"];
  const receipt = await removeBookBatch(input, {
    commit: async ids => { expect(ids).toEqual(["a", "b"]); input.push("late"); calls.push("commit"); },
    removed: id => { calls.push(id); }, releaseFiles: async ids => { expect(ids).toEqual(["a", "b"]); calls.push("files"); },
    warn: () => { throw Error("Unexpected warning"); },
  });
  expect(calls).toEqual(["commit", "a", "b", "files"]);
  expect(receipt).toEqual({ bookIds: ["a", "b"], committed: true, files: { status: "released" } });
});

test("rejected transaction does not emit removed or attempt file release", async () => {
  const failure = new AppError("db/locked", "locked"), calls: string[] = [];
  await expect(removeBookBatch(["a", "b"], {
    commit: async () => { throw failure; }, removed: () => { calls.push("removed"); },
    releaseFiles: async () => { calls.push("files"); }, warn: () => { calls.push("warn"); },
  })).rejects.toBe(failure);
  expect(calls).toEqual([]);
});

test("commit waits for real completion; cleanup failure reports committed state without raw text", async () => {
  let finish!: () => void;
  const calls: string[] = [], warnings: unknown[] = [];
  const failure = new AppError("fs/permission", "private path");
  const pending = removeBookBatch(["a"], {
    commit: () => new Promise(resolve => { finish = () => resolve(undefined); }),
    removed: id => { calls.push(id); }, releaseFiles: async () => { throw failure; }, warn: error => warnings.push(error),
  });
  await Promise.resolve(); expect(calls).toEqual([]);
  finish();
  const receipt = await pending;
  expect(receipt).toEqual({ bookIds: ["a"], committed: true, files: { status: "pending", errorCode: "fs/permission" } });
  expect(JSON.stringify(receipt)).not.toContain("private path");
  expect(warnings).toEqual([failure]);
  expect(calls).toEqual(["a"]);
});

test("cleanup retry has no event writes and preserves native reappearance refusal", async () => {
  const result = await releaseRemovedBookFiles(["a"], {
    releaseFiles: async () => { throw new AppError("library/book-reappeared", "restored"); }, warn: () => {},
  });
  expect(result).toEqual({ bookIds: ["a"], files: { status: "pending", errorCode: "library/book-reappeared" } });
  expect(await releaseRemovedBookFiles(["a"], { releaseFiles: async () => {}, warn: () => {} }))
    .toEqual({ bookIds: ["a"], files: { status: "released" } });
});

test("broken UI observers cannot hide a committed deletion or skip remaining cleanup", async () => {
  let cleaned = false, warnings = 0;
  const result = await removeBookBatch(["a"], { commit: async () => {}, removed: () => { throw Error("observer"); },
    releaseFiles: async () => { cleaned = true; }, warn: () => { warnings++; } });
  expect(result.files.status).toBe("released"); expect(cleaned).toBe(true); expect(warnings).toBe(1);
});
