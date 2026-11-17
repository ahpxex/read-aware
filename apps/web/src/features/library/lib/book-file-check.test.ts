import { afterAll, beforeAll, expect, test } from "bun:test";
import { MAX_BOOK_FILE_CHECK } from "@read-aware/core";
import type { LibraryBook } from "./library-types";
import type { RemoteBlobPresence } from "../../../platform/sync/sync-scheduler";
import { checkBookFiles } from "./book-file-check";

const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {} } });
});
afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "window", previous);
  else delete (globalThis as { window?: unknown }).window;
});

const book = (id: string, extra: Partial<LibraryBook> = {}) =>
  ({ id, title: id, format: "epub", fileLocal: false, ...extra }) as LibraryBook;

const shelf = [
  book("here", { fileLocal: true }),
  book("on-relay"),
  book("nowhere"),
  book("feed", { format: "virtual" }),
];

function harness(presence: RemoteBlobPresence, books = shelf) {
  const asked: string[][] = [];
  return {
    asked,
    deps: {
      list: async () => books,
      probe: async (keys: readonly string[]) => {
        asked.push([...keys]);
        return presence;
      },
    },
  };
}

const states = async (presence: RemoteBlobPresence, ids?: string[]) => {
  const { deps } = harness(presence);
  return Object.fromEntries(
    (await checkBookFiles(ids, undefined, deps)).checks.map((check) => [check.bookId, check.file]),
  );
};

test("with no ids, only books whose file is not on this device are checked, and only they are asked about", async () => {
  const { deps, asked } = harness({
    outcome: "held",
    held: { "bookfile:on-relay": true, "bookfile:nowhere": false },
  });
  const result = await checkBookFiles(undefined, undefined, deps);
  expect(result).toEqual({
    checks: [
      { bookId: "nowhere", title: "nowhere", file: { state: "unretrievable", reason: "not-on-relay" } },
      { bookId: "on-relay", title: "on-relay", file: { state: "retrievable" } },
    ],
    remaining: 0,
  });
  expect(asked).toEqual([["bookfile:nowhere", "bookfile:on-relay"]]);
});

test("a file on this device and a virtual book are answered without asking the backend", async () => {
  const { deps, asked } = harness({ outcome: "held", held: {} });
  const result = await checkBookFiles(["here", "feed"], undefined, deps);
  expect(result.checks.map((check) => check.file)).toEqual([{ state: "on-device" }, { state: "virtual" }]);
  expect(asked).toEqual([]);
});

test("only an answer from the backend makes a file gone; when nobody could be asked it is unknown", async () => {
  for (const reason of ["not-tauri", "sync-off"] as const)
    expect((await states({ outcome: "unavailable", reason }))["nowhere"]).toEqual({
      state: "unknown",
      reason: "no-sync",
    });
  // Signed out, or the backend's plugin is disabled: signing in again may bring the file back.
  expect((await states({ outcome: "unavailable", reason: "not-connected" }))["nowhere"]).toEqual({
    state: "unknown",
    reason: "not-connected",
  });
  expect((await states({ outcome: "unknown", reason: "unauthenticated" }))["on-relay"]).toEqual({
    state: "unknown",
    reason: "unauthenticated",
  });
  for (const reason of ["unreachable", "misdirected"] as const)
    expect((await states({ outcome: "unknown", reason }))["on-relay"]).toEqual({
      state: "unknown",
      reason: "unreachable",
    });
  expect((await states({ outcome: "unknown", reason: "unsupported" }))["on-relay"]).toEqual({
    state: "unknown",
    reason: "unverifiable",
  });
});

test("named books must exist, are checked once each, and the batch is bounded", async () => {
  const { deps } = harness({ outcome: "held", held: {} });
  await expect(checkBookFiles(["here", "ghost"], undefined, deps)).rejects.toMatchObject({
    code: "library/book-not-found",
  });
  await expect(checkBookFiles([], undefined, deps)).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect((await checkBookFiles(["here", "here"], undefined, deps)).checks).toHaveLength(1);
  const many = Array.from({ length: MAX_BOOK_FILE_CHECK + 3 }, (_, i) => book(`b${String(i).padStart(4, "0")}`));
  const large = harness({ outcome: "held", held: {} }, many);
  const result = await checkBookFiles(undefined, undefined, large.deps);
  expect(result.checks).toHaveLength(MAX_BOOK_FILE_CHECK);
  expect(result.remaining).toBe(3);
});

test("a cancelled check stops before answering", async () => {
  const owner = new AbortController();
  const { deps } = harness({ outcome: "held", held: {} });
  owner.abort(new Error("cancelled"));
  await expect(checkBookFiles(undefined, owner.signal, deps)).rejects.toThrow("cancelled");
});
