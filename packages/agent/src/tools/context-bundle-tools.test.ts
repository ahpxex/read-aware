import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { buildAgentTools } from "./registry";
import { resolveContextBundleScope } from "./context-bundle-tools";

const BOOK = "book-1" as Id, book: ThreadScope = { kind: "book", bookId: BOOK }, global: ThreadScope = { kind: "global", threadId: "t1" };
const text = (result: Awaited<ReturnType<AgentTool["execute"]>>) => JSON.parse((result.content[0] as { text: string }).text);
function tool(scope: ThreadScope, name: string, deps = createInMemoryDeps({ books: [{ id: BOOK, title: "Book", status: "reading" }], profile: "Reads slowly.", insights: { "book:book-1": "Discussed chapter one." } }).deps) {
  const found = buildAgentTools(scope, deps).find(candidate => candidate.name === name);
  if (!found) throw new Error(`${name} missing`);
  return { run: (params: unknown, signal?: AbortSignal) => found.execute("call", params, signal), deps };
}

describe("context bundle scope resolution", () => {
  test("book conversations are fenced to their own book; global conversations name books explicitly", () => {
    expect(resolveContextBundleScope(book, "book_memory_context", undefined)).toEqual({ kind: "book", id: BOOK });
    expect(resolveContextBundleScope(book, "reading_intent_context", BOOK)).toEqual({ kind: "book", id: BOOK });
    expect(resolveContextBundleScope(book, "conversation_insights_context", undefined)).toEqual({ kind: "book", id: BOOK });
    expect(resolveContextBundleScope(book, "user_profile_context", undefined)).toEqual({ kind: "user" });
    expect(() => resolveContextBundleScope(book, "book_memory_context", "other")).toThrow(expect.objectContaining({ code: "memory/forbidden" }));
    expect(() => resolveContextBundleScope(book, "user_profile_context", BOOK)).toThrow(expect.objectContaining({ code: "memory/invalid-query" }));
    expect(resolveContextBundleScope(global, "reading_intent_context", undefined)).toEqual({ kind: "user" });
    expect(resolveContextBundleScope(global, "reading_intent_context", "b9")).toEqual({ kind: "book", id: "b9" });
    expect(resolveContextBundleScope(global, "conversation_insights_context", undefined)).toEqual({ kind: "conversation", id: "t1" });
    expect(resolveContextBundleScope(global, "conversation_insights_context", "b9")).toEqual({ kind: "book", id: "b9" });
    expect(resolveContextBundleScope(global, "book_memory_context", "b9")).toEqual({ kind: "book", id: "b9" });
    expect(() => resolveContextBundleScope(global, "book_memory_context", undefined)).toThrow(expect.objectContaining({ code: "memory/invalid-query" }));
    for (const bad of ["", " ", 3, "x".repeat(257)]) expect(() => resolveContextBundleScope(global, "book_memory_context", bad)).toThrow(expect.objectContaining({ code: "memory/invalid-query" }));
  });
});

describe("context bundle tools", () => {
  test("capture publishes the host-resolved scope and returns the artifact; identical content is not a new version", async () => {
    const { run, deps } = tool(book, "capture_context_bundle");
    const first = text(await run({ kind: "conversation_insights_context" }));
    expect(first).toMatchObject({ changed: true, persistence: "event-log", bundle: { content: { kind: "conversation_insights_context", scope: { kind: "book", id: BOOK } } } });
    expect(first.bundle.content.items[0].text).toBe("Discussed chapter one.");
    expect(text(await run({ kind: "conversation_insights_context" }))).toMatchObject({ changed: false, bundle: { version: first.bundle.version } });
    await expect(run({ kind: "book_memory_context", bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
    expect((deps.contextBundles as unknown as { published(): unknown[] }).published()).toHaveLength(1);
    const global = tool({ kind: "global", threadId: "t1" }, "capture_context_bundle", deps);
    expect(text(await global.run({ kind: "user_profile_context" })).bundle.content.items[0]).toMatchObject({ kind: "curated_profile", text: "Reads slowly." });
    await expect(global.run({ kind: "book_memory_context" })).rejects.toMatchObject({ code: "memory/invalid-query" });
    expect(text(await global.run({ kind: "book_memory_context", bookId: BOOK })).bundle.content).toMatchObject({ scope: { kind: "book", id: BOOK }, items: [] });
  });

  test("history, pinned reads and export use the same selector; export returns an ISO-stamped read-only handle", async () => {
    const { run: capture, deps } = tool(global, "capture_context_bundle");
    const version = text(await capture({ kind: "user_profile_context" })).bundle.version;
    const list = tool(global, "list_context_bundles", deps), read = tool(global, "read_context_bundle", deps), exportTool = tool(global, "export_context_bundle", deps);
    const page = text(await list.run({ kind: "user_profile_context", limit: 10 }));
    expect(page).toMatchObject({ total: 1, items: [{ version }], nextOffset: null });
    expect(page.revision).toMatch(/^cbhist1:/);
    await expect(list.run({ kind: "user_profile_context", offset: 1 })).rejects.toMatchObject({ code: "memory/invalid-query" });
    expect(text(await read.run({ kind: "user_profile_context", version })).content.items).toHaveLength(1);
    expect(text(await read.run({ kind: "user_profile_context", version: `cb1:${"0".repeat(64)}` }))).toBeNull();
    expect(text(await read.run({ kind: "conversation_insights_context", version }))).toBeNull();
    const exported = text(await exportTool.run({ kind: "user_profile_context", version }));
    expect(exported.resource).toMatchObject({ source: "context", state: "ready", mimeType: "application/json", name: `user_profile_context-${version.slice(4)}.json` });
    expect(exported.resource.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(exportTool.run({ kind: "user_profile_context", version: `cb1:${"0".repeat(64)}` })).rejects.toMatchObject({ code: "fs/not-found" });
    const cancelled = new AbortController(); cancelled.abort(new Error("stop"));
    await expect(read.run({ kind: "user_profile_context", version }, cancelled.signal)).rejects.toMatchObject({ message: "stop" });
  });
});
