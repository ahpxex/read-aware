import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools, buildModelTools, createAgentTurnState } from "./registry";
import type { Id } from "@read-aware/core";

for (const scope of [
  { kind: "global", threadId: "tools" },
  { kind: "book", bookId: "b" as Id },
] as const) {
  test(`${scope.kind}: compact model surface preserves the complete discoverable catalog`, async () => {
    const { deps } = createInMemoryDeps();
    const state = createAgentTurnState();
    const initial = buildModelTools(scope, deps, state);
    expect(initial.length).toBeLessThanOrEqual(21);
    expect(
      JSON.stringify(initial.map(({ name, description, parameters }) => ({ name, description, parameters }))).length,
    ).toBeLessThan(32_000);
    expect(initial.some((t) => t.name === "request_backup")).toBe(false);
    const discover = initial.find((t) => t.name === "get_host_capabilities")!;
    const catalog = buildAgentTools(scope, deps, state)
      .map((t) => t.name)
      .sort();
    const found: string[] = [];
    let offset = 0,
      revision: string | undefined;
    do {
      const result = await discover.execute("discover", { catalog: "tools", limit: 20, offset, revision });
      const page = JSON.parse((result.content[0] as { text: string }).text);
      found.push(...page.items.map((t: { name: string }) => t.name));
      expect(buildModelTools(scope, deps, state).length).toBeLessThanOrEqual(33);
      offset = page.nextOffset;
      revision = page.revision;
    } while (offset !== null);
    expect(found.sort()).toEqual(catalog);
    await discover.execute("load", { catalog: "tools", query: "request_backup" });
    expect(buildModelTools(scope, deps, state).some((t) => t.name === "request_backup")).toBe(true);
    expect(buildModelTools(scope, deps, createAgentTurnState()).some((t) => t.name === "request_backup")).toBe(false);
  });
}

test("multi-keyword discovery loads the relevant family even when no description contains the whole phrase", async () => {
  const { deps } = createInMemoryDeps();
  const scope = { kind: "global", threadId: "find" } as const;
  for (const [query, expected] of [
    ["reading stats time spent", "query_reading_stats"],
    ["annotation edit update", "apply_annotation_changes"],
  ]) {
    const state = createAgentTurnState();
    const tool = buildModelTools(scope, deps, state).find((t) => t.name === "get_host_capabilities")!;
    const result = await tool.execute("find", { catalog: "tools", query });
    const page = JSON.parse((result.content[0] as { text: string }).text);
    expect(page.items.map((item: { name: string }) => item.name)).toContain(expected);
    expect(buildModelTools(scope, deps, state).map((t) => t.name)).toContain(expected);
    if (expected === "query_reading_stats") expect(page.items[0].name).toBe(expected);
  }
});

test("a book thread offers the reader's in-book actions without discovery", () => {
  const { deps } = createInMemoryDeps();
  const names = (scope: Parameters<typeof buildModelTools>[0]) =>
    buildModelTools(scope, deps, createAgentTurnState()).map((tool) => tool.name);
  const inBook = [
    "create_annotation",
    "apply_annotation_changes",
    "save_bookmark",
    "get_reading_session",
    "classify_book",
  ];
  const book = names({ kind: "book", bookId: "b" as Id });
  for (const name of inBook) expect(book).toContain(name);
  const global = names({ kind: "global", threadId: "g" });
  for (const name of inBook) expect(global).not.toContain(name);
});
