import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import type { ChapterDigest } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildGraphTools } from "./graph-tools";
import { createAgentTurnState } from "./turn-state";

const BOOK = "graph-book" as Id;

/** 三章图：回读场景（读者在 #1，库里 digest 到 #2）用 fence 复现。 */
const DIGESTS: ChapterDigest[] = [
  {
    chapterIndex: 0,
    summary: "米嘉回乡，与父亲费奥多尔起了争执。",
    characters: [
      { name: "德米特里·费奥多罗维奇", aliases: ["米嘉"], note: "长子，冲动" },
      { name: "费奥多尔·巴甫洛维奇", note: "父亲" },
    ],
    relations: [{ from: "费奥多尔·巴甫洛维奇", kind: "父亲", to: "德米特里·费奥多罗维奇" }],
    digestVersion: 2,
    flavor: "narrative",
  },
  {
    chapterIndex: 1,
    summary: "阿辽沙在修道院见长老。",
    characters: [{ name: "阿辽沙", note: "幼子，见习修士" }],
    relations: [],
    digestVersion: 2,
    flavor: "narrative",
  },
  {
    chapterIndex: 2,
    summary: "斯乜尔加科夫初次登场。",
    characters: [{ name: "斯乜尔加科夫", note: "厨子" }],
    relations: [{ from: "斯乜尔加科夫", kind: "仆人", to: "费奥多尔·巴甫洛维奇" }],
    digestVersion: 2,
    flavor: "narrative",
  },
];

function tools(options?: {
  fenceAt?: number;
  finished?: boolean;
  global?: boolean;
  permissionGranted?: boolean;
}) {
  const { deps } = createInMemoryDeps({
    books: [
      {
        id: BOOK,
        title: "Graph Novel",
        status: options?.finished ? "finished" : "reading",
        narrativity: "narrative",
      },
    ],
    chapterDigests: { [BOOK]: DIGESTS },
  });
  const state = createAgentTurnState();
  state.spoilerPermissionGranted = options?.permissionGranted ?? false;
  if (options?.fenceAt !== undefined) state.spoilerFence = { throughChapterIndex: options.fenceAt };
  const scope = options?.global
    ? ({ kind: "global", threadId: "graph-thread" } as const)
    : ({ kind: "book", bookId: BOOK } as const);
  const built = buildGraphTools(scope, deps, state);
  return Object.fromEntries(built.map((tool) => [tool.name, tool]));
}

function parse(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("query_book_graph", () => {
  test("profiles match by alias, case-insensitively, with provenance edges", async () => {
    const { query_book_graph } = tools({ fenceAt: 2 });
    const out = parse(await query_book_graph!.execute("q1", { names: ["米嘉"] }));
    const profiles = out.profiles as Array<Record<string, unknown>>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe("德米特里·费奥多罗维奇");
    expect(profiles[0]!.appearsInChapters).toEqual([0]);
    const relations = profiles[0]!.relations as Array<Record<string, unknown>>;
    expect(relations[0]!.kind).toBe("父亲");
    expect(relations[0]!.establishedAt).toBe(0);
  });

  test("unmatched names are reported with a text-search pointer", async () => {
    const { query_book_graph } = tools({ fenceAt: 2 });
    const out = parse(await query_book_graph!.execute("q2", { names: ["格露莘卡"] }));
    expect(out.notFound).toEqual(["格露莘卡"]);
  });

  test("fence clamps the graph to chapters before the reader (re-reading scenario)", async () => {
    const { query_book_graph } = tools({ fenceAt: 1 });
    const out = parse(await query_book_graph!.execute("q3", {}));
    // 读者在 #1：只看得见 #0；#2 的斯乜尔加科夫不得出现。
    expect(out.chaptersDigested).toBe(1);
    const names = (out.entities as Array<{ name: string }>).map((entity) => entity.name);
    expect(names).not.toContain("斯乜尔加科夫");
    expect(names).toContain("德米特里·费奥多罗维奇");
  });

  test("narrative book with no fence withholds the graph entirely", async () => {
    const { query_book_graph } = tools();
    const out = parse(await query_book_graph!.execute("q4", {}));
    expect(out.graph).toBe("unavailable");
  });

  test("confirmSpoiler lifts the clamp; string 'false' does not", async () => {
    const { query_book_graph } = tools({ fenceAt: 1, permissionGranted: true });
    const granted = parse(
      await query_book_graph!.execute("q5", { confirmSpoiler: true }),
    );
    expect(granted.chaptersDigested).toBe(3);
    const denied = parse(
      await query_book_graph!.execute("q6", { confirmSpoiler: "false" }),
    );
    expect(denied.chaptersDigested).toBe(1);
  });

  test("confirmSpoiler cannot self-authorize graph access", async () => {
    const { query_book_graph } = tools({ fenceAt: 1 });
    await expect(query_book_graph!.execute("q-denied", { confirmSpoiler: true })).rejects.toThrow(
      "reader has not explicitly granted spoiler permission",
    );
  });

  test("chapter mode beyond the fence explains instead of leaking", async () => {
    const { query_book_graph } = tools({ fenceAt: 1 });
    const out = parse(await query_book_graph!.execute("q7", { chapterIndex: 2 }));
    expect(out.graph).toBe("miss");
    expect(String(out.note)).toContain("beyond the reader's position");
  });

  test("finished book serves the whole graph without a fence", async () => {
    const { query_book_graph } = tools({ finished: true });
    const out = parse(await query_book_graph!.execute("q8", {}));
    expect(out.chaptersDigested).toBe(3);
    expect(out.edgeCount).toBe(2);
  });

  test("global scope serves the digest set as-is (its coverage is the read bound)", async () => {
    const { query_book_graph } = tools({ global: true });
    const out = parse(await query_book_graph!.execute("q9", { bookId: BOOK }));
    expect(out.chaptersDigested).toBe(3);
  });
});
