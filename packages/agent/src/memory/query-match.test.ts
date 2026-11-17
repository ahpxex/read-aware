import { expect, test } from "bun:test";
import shared from "./memory-query-cases.json";
import { matchesMemoryQuery } from "./query-match";

test("the in-memory match gives the store's FTS results on the shared cases", () => {
  for (const { query, matches } of shared.cases) {
    const found = shared.memories.filter((memory) => matchesMemoryQuery(memory.content, query)).map(({ id }) => id);
    expect({ query, found: found.sort() }).toEqual({ query, found: [...matches].sort() });
  }
  expect(matchesMemoryQuery("anything", "  ")).toBe(true);
});
