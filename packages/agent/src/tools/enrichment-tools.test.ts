import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildEnrichmentTools } from "./enrichment-tools";

test("enrichment tools restrict book scope, preserve acceptance and pass cancellation to the shared port", async () => {
  const { deps } = createInMemoryDeps(); const calls: unknown[] = [];
  deps.library.getEnrichment = async (bookId, signal) => { calls.push([bookId, signal]); return { bookId, cover: { status: "unchecked", local: false },
    metadataPending: false, supported: true, sourceLocal: true, job: { phase: "idle", startedAt: null, finishedAt: null, errorCode: null, reason: null } }; };
  deps.library.retryEnrichment = async (bookId, signal) => ({ status: "queued", snapshot: await deps.library.getEnrichment(bookId, signal) });
  const signal = new AbortController().signal;
  const tools = buildEnrichmentTools({ kind: "book", bookId: "book" as Id }, deps);
  expect(JSON.stringify(await tools[1]!.execute("retry", {}, signal))).toContain("queued");
  expect(calls).toEqual([["book", signal]]);
  await expect(tools[1]!.execute("other", { bookId: "other" }, signal)).rejects.toMatchObject({ code: "memory/forbidden" });
  const global = buildEnrichmentTools({ kind: "global", threadId: "thread" }, deps);
  await expect(global[0]!.execute("missing", {}, signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  deps.library.getEnrichment = async () => { throw Error("read failed"); };
  await expect(global[0]!.execute("failed", { bookId: "book" }, signal)).rejects.toThrow("read failed");
});
