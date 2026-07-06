import { describe, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import { seedMemory } from "../testing/fixtures";
import { extractMemories } from "./extraction";

const MODEL = { id: "fake", provider: "fake", api: "fake" } as unknown as Model<Api>;
const BOOK_SCOPE = { kind: "book", bookId: "b1" as Id } as const;
const GLOBAL_SCOPE = { kind: "global", threadId: "t1" } as const;

function completeWith(text: string) {
  return async () => fauxAssistantMessage(text);
}

const BASE = {
  model: MODEL,
  userText: "q",
  assistantText: "a",
  existing: [],
};

describe("extractMemories", () => {
  test("parses candidates and maps book scope to the thread's book", async () => {
    const result = await extractMemories({
      ...BASE,
      scope: BOOK_SCOPE,
      complete: completeWith(
        '{"new": [{"scope": "book", "kind": "insight", "content": "货币先于铸币"}, {"scope": "user", "kind": "preference", "content": "喜欢刨根问底"}], "reinforced": []}',
      ),
    });
    expect(result.newMemories).toEqual([
      { scope: "book:b1", kind: "insight", content: "货币先于铸币" },
      { scope: "user", kind: "preference", content: "喜欢刨根问底" },
    ]);
  });

  test("drops disallowed scopes and unknown kinds", async () => {
    const result = await extractMemories({
      ...BASE,
      scope: GLOBAL_SCOPE,
      complete: completeWith(
        '{"new": [{"scope": "book", "kind": "insight", "content": "x"}, {"scope": "global", "kind": "vibe", "content": "y"}, {"scope": "global", "kind": "insight", "content": "z"}], "reinforced": []}',
      ),
    });
    expect(result.newMemories).toEqual([{ scope: "global", kind: "insight", content: "z" }]);
  });

  test("clamps to three candidates and tolerates code fences", async () => {
    const items = Array.from({ length: 5 }, (_, i) => `{"scope": "user", "kind": "fact", "content": "m${i}"}`);
    const result = await extractMemories({
      ...BASE,
      scope: BOOK_SCOPE,
      complete: completeWith('```json\n{"new": [' + items.join(",") + '], "reinforced": []}\n```'),
    });
    expect(result.newMemories).toHaveLength(3);
  });

  test("keeps only reinforced ids that actually exist", async () => {
    const result = await extractMemories({
      ...BASE,
      scope: BOOK_SCOPE,
      existing: [seedMemory({ id: "mem-1", scope: "user", content: "known" })],
      complete: completeWith('{"new": [], "reinforced": ["mem-1", "mem-404"]}'),
    });
    expect(result.reinforcedIds).toEqual(["mem-1"]);
  });

  test("garbage output and thrown errors yield the empty result", async () => {
    const garbage = await extractMemories({
      ...BASE,
      scope: BOOK_SCOPE,
      complete: completeWith("我觉得没什么值得记的。"),
    });
    expect(garbage).toEqual({ newMemories: [], reinforcedIds: [] });

    const thrown = await extractMemories({
      ...BASE,
      scope: BOOK_SCOPE,
      complete: async () => {
        throw new Error("network down");
      },
    });
    expect(thrown).toEqual({ newMemories: [], reinforcedIds: [] });
  });
});
