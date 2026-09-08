import { expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildNavigationTools } from "./navigation-tools";
import { buildReaderTools } from "./reader-tools";
import { createAgentTurnState } from "./turn-state";

function fixture() {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book", progressPercent: 40, status: "reading" }],
    chapters: { book: [{ title: "Chapter 10", text: "needle before", hrefs: ["first"] }, { title: "Chapter 20", text: "needle spoiler", hrefs: ["second"] }] } });
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const scope = { kind: "book", bookId: "book" } as const;
  const tools = [...buildNavigationTools(scope, deps, state), ...buildReaderTools(scope, deps, state)];
  return { deps, state, tool: (name: string) => tools.find(tool => tool.name === name)! };
}
function value(result: AgentToolResult<unknown>) {
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  return JSON.parse(result.content[0].text);
}

test("precise navigation search preserves the turn's original spoiler fence and records returned evidence", async () => {
  const { deps, state, tool } = fixture();
  const signal = new AbortController().signal;
  const original = deps.bookText.searchLocations;
  let actualSignal: AbortSignal | undefined;
  deps.bookText.searchLocations = (input, passed) => { actualSignal = passed; return original(input, passed); };
  const result = value(await tool("find_book_locations").execute("test", { query: "needle" }, signal));
  expect(actualSignal).toBe(signal);
  expect(result.hits).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("spoiler");
  expect(state.evidenceTexts).toEqual(["needle before"]);
  expect(state.spoilerGranted).toBe(false);
});

test("the model cannot grant itself spoilers with a parameter", async () => {
  const { state, tool } = fixture();
  await expect(tool("find_book_locations").execute("test", { query: "needle", confirmSpoiler: true })).rejects.toThrow("not explicitly granted");
  expect(state.spoilerPermissionDenied).toBe(true);
  expect(state.evidenceTexts).toEqual([]);
});

test("an explicit host-verified grant allows the full query but a string false does not", async () => {
  const { state, tool } = fixture();
  state.spoilerPermissionGranted = true;
  expect(value(await tool("find_book_locations").execute("test", { query: "needle", confirmSpoiler: "false" })).hits).toHaveLength(1);
  expect(value(await tool("find_book_locations").execute("test", { query: "needle", confirmSpoiler: true })).hits).toHaveLength(2);
  expect(state.spoilerGranted).toBe(true);
});

test("navigation cannot turn a later viewport into authorized text", async () => {
  const { deps, state, tool } = fixture();
  const session = await deps.reader.getSession();
  deps.reader.getSession = async () => ({ ...session, visibleText: "spoiler after navigation" });
  expect(value(await tool("get_reading_session").execute("test", {})).visibleText).toBe("");
  state.spoilerPermissionGranted = true;
  expect(value(await tool("get_reading_session").execute("test", {})).visibleText).toBe("spoiler after navigation");
});

test("TOC locations round-trip through open_book without chapter-number arithmetic", async () => {
  const { deps, tool } = fixture();
  const toc = value(await tool("get_navigation_toc").execute("test", {}));
  expect(toc.entries[0]).toMatchObject({ label: "Chapter 10", ordinal: 1 });
  let passed: unknown;
  const original = deps.reader.goTo;
  deps.reader.goTo = (target, signal) => { passed = target; return original(target, signal); };
  await tool("open_book").execute("test", { location: toc.entries[0].location });
  expect(passed).toEqual(toc.entries[0].location);
  await expect(tool("open_book").execute("test", { location: toc.entries[0].location, fraction: 0.5 })).rejects.toThrow("conflicting targets");
  await expect(tool("open_book").execute("test", { location: toc.entries[0].location, bookId: "other" })).rejects.toThrow("conflicting targets");
});

test("other-book searches do not reuse the current book's chapter fence or mark its spoiler grant", async () => {
  const { deps, state, tool } = fixture();
  let input: unknown;
  const original = deps.bookText.searchLocations;
  deps.bookText.searchLocations = (query, signal) => { input = query; return original(query, signal); };
  await tool("find_book_locations").execute("test", { bookId: "other", query: "needle", confirmSpoiler: true });
  expect(input).not.toHaveProperty("throughChapterIndex");
  expect(state.spoilerGranted).toBe(false);
});

test("the model fixture paginates non-Latin queries without corrupting its cursor", async () => {
  const { deps } = createInMemoryDeps({ chapters: { book: [{ text: Array(13).fill("线索").join(" ") }] } });
  const tool = buildNavigationTools({ kind: "book", bookId: "book" }, deps).find(tool => tool.name === "find_book_locations")!;
  const first = value(await tool.execute("test", { query: "线索" }));
  expect(first.hits).toHaveLength(12);
  const last = value(await tool.execute("test", { query: "线索", cursor: first.nextCursor, contentVersion: first.contentVersion }));
  expect(last.hits).toHaveLength(1);
  expect(last.nextCursor).toBeNull();
});
