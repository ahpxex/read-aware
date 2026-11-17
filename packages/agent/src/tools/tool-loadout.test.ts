import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildModelTools, createAgentTurnState } from "./registry";
import {
  MAX_LOADED_TOOLS,
  beginLoadoutTurn,
  createToolLoadout,
  loadTools,
  noteToolUse,
  resetToolLoadout,
} from "./tool-loadout";

const names = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

test("loading past the budget unloads the least recently needed tools and names them", () => {
  const loadout = createToolLoadout();
  expect(loadTools(loadout, names("a", 10)).unloaded).toEqual([]);
  const { loaded, unloaded } = loadTools(loadout, names("b", 5));
  expect(unloaded).toEqual(["a0", "a1", "a2"]);
  expect(loaded).toHaveLength(MAX_LOADED_TOOLS);
  expect(loaded.slice(-5)).toEqual(names("b", 5));
});

test("a tool called in this reply survives later discoveries; an uncalled one does not", () => {
  const loadout = createToolLoadout();
  loadTools(loadout, names("a", 10));
  noteToolUse(loadout, "a0");
  // Two more discoveries, as in the session where a tool in use was unloaded mid-task.
  expect(loadTools(loadout, names("b", 10)).unloaded).not.toContain("a0");
  const { loaded, unloaded } = loadTools(loadout, names("c", 10));
  expect(loaded).toContain("a0");
  expect(unloaded).not.toContain("a0");
  expect(loaded).not.toContain("a1");
});

test("a call refreshes recency without the reply boundary", () => {
  const loadout = createToolLoadout();
  loadTools(loadout, names("a", 12));
  noteToolUse(loadout, "a0");
  beginLoadoutTurn(loadout);
  // No longer in use, yet the most recently needed: a1 goes first.
  expect(loadTools(loadout, ["b0"]).unloaded).toEqual(["a1"]);
});

test("a reply that calls more tools than the budget keeps them until it ends", () => {
  const loadout = createToolLoadout();
  loadTools(loadout, names("a", 12));
  for (const name of names("a", 12)) noteToolUse(loadout, name);
  const { loaded, unloaded } = loadTools(loadout, names("b", 3));
  expect(unloaded).toEqual([]);
  expect(loaded).toHaveLength(15);
  beginLoadoutTurn(loadout);
  expect(loadout.loaded.size).toBe(MAX_LOADED_TOOLS);
  expect([...loadout.loaded].slice(-3)).toEqual(names("b", 3));
});

test("the tools just requested are never unloaded to make room for themselves", () => {
  const loadout = createToolLoadout();
  const { loaded, unloaded } = loadTools(loadout, names("a", 14));
  expect(unloaded).toEqual([]);
  expect(loaded).toHaveLength(14);
});

test("calling a tool that is not loaded changes nothing; reset empties the loadout", () => {
  const loadout = createToolLoadout();
  noteToolUse(loadout, "list_books");
  expect(loadout.usedThisTurn.size).toBe(0);
  loadTools(loadout, ["a0"]);
  noteToolUse(loadout, "a0");
  resetToolLoadout(loadout);
  expect(loadout.loaded.size + loadout.usedThisTurn.size).toBe(0);
});

for (const scope of [
  { kind: "global", threadId: "loadout" },
  { kind: "book", bookId: "b" as Id },
] as const) {
  test(`${scope.kind}: discovery reports unloaded tools and keeps the one in use callable`, async () => {
    const { deps } = createInMemoryDeps();
    const state = createAgentTurnState();
    const discover = async (query: string) => {
      const tool = buildModelTools(scope, deps, state).find((t) => t.name === "get_host_capabilities")!;
      const result = await tool.execute("discover", { catalog: "tools", query });
      return JSON.parse((result.content[0] as { text: string }).text) as {
        loadedTools: string[];
        unloadedTools?: string[];
      };
    };
    const first = await discover("get_book_content_state");
    expect(first.loadedTools).toEqual(["get_book_content_state"]);
    expect(first.unloadedTools).toBeUndefined();
    noteToolUse(state.loadout, "get_book_content_state");
    const unloaded: string[] = [];
    for (const query of ["resource", "sync", "window", "plugin"])
      unloaded.push(...((await discover(query)).unloadedTools ?? []));
    expect(unloaded.length).toBeGreaterThan(0);
    expect(unloaded).not.toContain("get_book_content_state");
    expect(buildModelTools(scope, deps, state).map((t) => t.name)).toContain("get_book_content_state");
  });
}
