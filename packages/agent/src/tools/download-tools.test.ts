import { expect, test } from "bun:test";
import type { Id, ResourceDownloadInput } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildDownloadTools } from "./download-tools";

test("download is global-only, approves exact immutable arguments and returns only metadata", async () => {
  const { deps, stores } = createInMemoryDeps(); const calls: ResourceDownloadInput[] = [];
  const input = { url: "https://example.com/book.epub", name: "book.epub" };
  deps.downloadResource = async (thread, requested) => { expect(thread).toBe("global:thread"); calls.push(requested); return { status: "redirect", url: "https://cdn.example.com/book.epub", httpStatus: 302 }; };
  const tool = buildDownloadTools({ kind: "global", threadId: "thread" }, deps)[0]!;
  expect(buildDownloadTools({ kind: "book", bookId: "book" as Id }, deps)).toEqual([]);
  const original = deps.interactions.request;
  deps.interactions.request = async request => { input.url = "https://evil.test/changed"; input.name = "changed"; return original(request); };
  const result = await tool.execute("one", input);
  expect(calls).toEqual([{ url: "https://example.com/book.epub", name: "book.epub" }]);
  expect(stores.interactions[0]).toMatchObject({ action: "download-resource", subject: "book.epub\nhttps://example.com/book.epub" });
  expect(JSON.stringify(result)).toContain("redirect");
  expect(calls).toHaveLength(1);
  deps.interactions.request = async () => ({ optionId: "decline" });
  expect(JSON.stringify(await tool.execute("decline", input))).toContain("false"); expect(calls).toHaveLength(1);
});

test("invalid URLs, names and cancelled confirmations never dispatch a download", async () => {
  const { deps, stores } = createInMemoryDeps(); let calls = 0;
  deps.downloadResource = async () => { calls++; return { status: "http-error", httpStatus: 404 }; };
  const tool = buildDownloadTools({ kind: "global", threadId: "thread" }, deps)[0]!;
  for (const input of [{ url: "http://example.com/a", name: "a" }, { url: "https://user:pass@example.com/a", name: "a" },
    { url: "https://example.com/a#fragment", name: "a" }, { url: "https://example.com/a", name: "../file" },
    { url: "file:///private/file", name: "a" }, { url: "https://example.com/a", name: "a", headers: {} }]) {
    await expect(tool.execute("invalid", input)).rejects.toBeDefined();
  }
  expect(stores.interactions).toHaveLength(0);
  const controller = new AbortController();
  deps.interactions.request = async () => { controller.abort(new Error("Stopped")); return { optionId: "approve" }; };
  await expect(tool.execute("abort", { url: "https://example.com/a", name: "a" }, controller.signal)).rejects.toThrow("Stopped");
  expect(calls).toBe(0);
});
