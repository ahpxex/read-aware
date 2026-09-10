import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { buildPluginContext } from "./plugin-context";
import { getPluginAgentTools } from "./plugin-tools";
import { pluginBookCardResult } from "./plugin-book-cards";

const globalScope = { kind: "global" as const, threadId: "cards" };
const manifest = { id: "book-cards", name: "Book Cards", version: "1", schemaVersion: 1,
  requires: { contributions: { agentTools: "^1.3.0" } } };

test("plugin book cards hydrate actual shelf metadata, enforce grants and preserve scope", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let reads = 0, failure = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string) => {
      if (command !== "library_load") throw Error(`Unexpected IPC: ${command}`);
      reads++; if (failure) throw { code: "db/locked", message: "private database failure" };
      return [{ id: "a", title: "Actual title", author: "Actual author", format: "epub", path: "/private/a" },
        { id: "b", title: "Second title", format: "epub" }];
    },
  } } });
  const actor = buildPluginContext({ ...manifest, permissions: ["agent:tools", "library:read"] }, "1", []);
  const denied = buildPluginContext({ ...manifest, id: "cards-denied", permissions: ["agent:tools"] }, "1", []);
  actor.lifecycle.promote(); denied.lifecycle.promote();
  const response = { gist: "Two relevant books", bookCards: [{ bookId: "a" }, { bookId: "b" }, { bookId: "unknown" }, { bookId: "a" }] };
  try {
    actor.context.contributions.agentTools!.register({ name: "show", description: "Show books", execute: () => response });
    denied.context.contributions.agentTools!.register({ name: "show", description: "Show books", execute: () => response,
      resolveBookCards: () => [{ bookId: "a", title: "Forged" }] } as never);
    const tools = getPluginAgentTools(globalScope);
    const tool = tools.find(item => item.name === "plugin_book_cards_show")!;
    const result = await tool.execute("show", {});
    expect(result.details).toEqual({ reference: { kind: "books", books: [
      { bookId: "a", title: "Actual title", author: "Actual author" }, { bookId: "b", title: "Second title", author: undefined },
    ] } });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ gist: response.gist, presented: ["a", "b"], skippedUnknown: ["unknown"], skippedScope: [] }) }]);
    expect(JSON.stringify(result)).not.toContain("/private"); expect(reads).toBe(1);
    await expect(tools.find(item => item.name === "plugin_cards_denied_show")!.execute("denied", {})).rejects.toMatchObject({ code: "memory/forbidden" });
    expect(reads).toBe(1);
    const scoped = getPluginAgentTools({ kind: "book", bookId: "a" as Id }).find(item => item.name === tool.name)!;
    const book = await scoped.execute("book", {});
    expect(book.details).toMatchObject({ reference: { kind: "books", books: [{ bookId: "a", title: "Actual title" }] } });
    expect(book.content).toEqual([{ type: "text", text: JSON.stringify({ gist: response.gist, presented: ["a"], skippedUnknown: [], skippedScope: ["b", "unknown"] }) }]);
    failure = true; await expect(tool.execute("failed", {})).rejects.toMatchObject({ code: "db/locked" }); failure = false;
    const cancelled = new AbortController(); cancelled.abort();
    const before = reads; await expect(tool.execute("cancelled", {}, cancelled.signal)).rejects.toThrow(); expect(reads).toBe(before);
    actor.lifecycle.stop(); await expect(tool.execute("retired", {})).rejects.toThrow(); expect(reads).toBe(before);
  } finally {
    actor.lifecycle.stop(); denied.lifecycle.stop();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("book card validation rejects executable or fabricated display fields without reading", async () => {
  let reads = 0;
  const resolve = async () => { reads++; return []; };
  for (const bookCards of [[], [{ bookId: "" }], [{ bookId: "a", title: "Forged" }], [{ bookId: "a", url: "https://example.org" }],
    [{ bookId: "x".repeat(257) }], Array.from({ length: 25 }, () => ({ bookId: "a" })), [null]]) {
    await expect(pluginBookCardResult({ gist: null, bookCards }, globalScope, resolve)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  await expect(pluginBookCardResult({ bookCards: [{ bookId: "a" }], wordCards: [] }, globalScope, resolve)).rejects.toThrow();
  expect(await pluginBookCardResult({ other: true }, globalScope, resolve)).toBeNull();
  expect(reads).toBe(0);
  expect(await pluginBookCardResult({ gist: "missing", bookCards: [{ bookId: "gone" }] }, globalScope, resolve)).toEqual({
    books: [], ack: { gist: "missing", presented: [], skippedUnknown: ["gone"], skippedScope: [] },
  });
});
