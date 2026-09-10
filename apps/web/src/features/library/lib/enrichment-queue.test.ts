import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { EnrichmentQueue, type EnrichmentRequest } from "./enrichment-queue";

test("background enrichment is serial, queued flags coalesce and running requests join", async () => {
  const gate = Promise.withResolvers<void>(), calls: EnrichmentRequest[] = [];
  const queue = new EnrichmentQueue(async request => { calls.push({ ...request }); if (request.bookId === "a") await gate.promise; return { reason: null }; }, () => {});
  const a = queue.enqueue({ bookId: "a", cover: true, metadata: false });
  expect(queue.snapshot("a").phase).toBe("queued");
  await Bun.sleep(0); expect(queue.snapshot("a").phase).toBe("running");
  expect(queue.enqueue({ bookId: "a", cover: true, metadata: false })).toBe(a);
  const b = queue.enqueue({ bookId: "b", cover: false, metadata: true, origin: "plugin:fixture" });
  expect(queue.enqueue({ bookId: "b", cover: true, metadata: false })).toBe(b);
  expect(calls).toHaveLength(1); gate.resolve();
  await b.done;
  expect(calls[1]).toEqual({ bookId: "b", cover: true, metadata: true, origin: "plugin:fixture" });
  expect(queue.snapshot("a")).toMatchObject({ phase: "completed", errorCode: null });
  const external = queue.snapshot("b"); external.phase = "failed";
  expect(queue.snapshot("b").phase).toBe("completed");
});

test("failures stay visible, skipped is not completed, and retries do not poison the queue", async () => {
  let fail = true; const errors: unknown[] = [];
  const queue = new EnrichmentQueue(async () => { if (fail) throw new AppError("fs/not-found", "file gone"); return { reason: "source-unavailable" }; }, error => errors.push(error));
  const request = { bookId: "a", cover: true, metadata: false };
  expect(await queue.enqueue(request).done).toMatchObject({ phase: "failed", errorCode: "fs/not-found" });
  fail = false;
  expect(await queue.enqueue(request).done).toMatchObject({ phase: "skipped", reason: "source-unavailable", errorCode: null });
  expect(errors).toHaveLength(1);
});

test("an already-parsed reader does not wait behind unrelated parsing or create another same-book writer", async () => {
  const gate = Promise.withResolvers<void>();
  const queue = new EnrichmentQueue(async () => { await gate.promise; return { reason: null }; }, () => {});
  const background = queue.enqueue({ bookId: "a", cover: true, metadata: false });
  const open = queue.enqueue({ bookId: "b", cover: true, metadata: false }, async () => ({ reason: "not-needed" }), true);
  expect((await open.done).phase).toBe("skipped");
  expect(queue.enqueue({ bookId: "a", cover: true, metadata: false }, async () => { throw Error("must join"); }, true)).toBe(background);
  gate.resolve(); await background.done;
});
