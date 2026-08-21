/**
 * 工具表面契约：每个内置工具塞给模型的文本必须"可读"——不允许裸毫秒字段、
 * 不允许 epoch 毫秒数字、体积有上界。新工具必须在 SURFACE_CASES 里登记一组
 * 可执行的参数，否则完备性检查会失败——这是有意的强制。
 */
import { describe, expect, test } from "bun:test";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps, type InMemorySeed } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { buildAgentTools } from "./registry";

const BOOK_ID = "book-1" as Id;

function seed(): InMemorySeed {
  return {
    books: [
      {
        id: BOOK_ID,
        title: "The Locked Room",
        author: "Mira Vale",
        progressPercent: 18,
        status: "reading",
      },
    ],
    collections: [{ id: "col-1" as Id, name: "Mysteries", createdAt: "2026-06-01T00:00:00Z" }],
    bookStats: [
      {
        bookId: BOOK_ID,
        progressPercent: 18,
        status: "reading",
        totalMs: 5_427_000,
        firstReadAt: "2026-07-01T08:00:00Z",
        lastReadAt: "2026-08-09T21:30:00Z",
        daily: { "2026-08-09": 2_520_000, "2026-07-01": 2_907_000 },
      },
    ],
    annotations: [
      {
        kind: "note",
        id: "note-1" as Id,
        bookId: BOOK_ID,
        body: "The clock stopped at nine.",
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
      {
        kind: "highlight",
        id: "hl-1" as Id,
        bookId: BOOK_ID,
        text: "wet footprints",
        color: "yellow",
        style: "highlight",
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ],
    chapters: {
      [BOOK_ID]: [
        { title: "Wet Footprints", text: "Victor is found dead in a locked study." },
      ],
    },
  };
}

/**
 * 每个工具一组可成功执行的参数。凡是新增工具，必须在这里补一条 ——
 * 完备性断言会指认漏网的名字。
 */
const SURFACE_CASES: Record<string, Record<string, unknown>> = {
  list_books: {},
  get_book_overview: { bookId: BOOK_ID },
  get_annotations: { bookId: BOOK_ID },
  list_collections: {},
  get_reading_stats: {},
  update_book: { bookId: BOOK_ID, starred: true },
  manage_collection: { action: "create", name: "New shelf" },
  delete_book: { bookId: BOOK_ID },
  delete_collection: { collectionId: "col-1" },
  create_annotation: { kind: "note", bookId: BOOK_ID, body: "A stray thought." },
  edit_annotation: { annotationId: "note-1", body: "Revised thought." },
  delete_annotation: { annotationId: "hl-1" },
  search_memory: {},
  remember: { content: "The reader enjoys locked-room mysteries.", scope: "user", kind: "preference" },
  search_conversation: { queries: ["clue"] },
  get_recent_turns: {},
  get_conversation_insights: { bookId: BOOK_ID },
  get_toc: { bookId: BOOK_ID },
  read_chapter: { bookId: BOOK_ID, chapterIndex: 0 },
  search_book_text: { queries: ["footprints"], bookId: BOOK_ID },
  query_book_graph: { bookId: BOOK_ID },
  present_books: { bookIds: [BOOK_ID] },
  open_book: { bookId: BOOK_ID },
  ask_user: {
    question: "Which direction?",
    options: [
      { id: "summarize", label: "Summarize" },
      { id: "compare", label: "Compare" },
    ],
  },
  get_settings: {},
  update_settings: { changes: [{ path: "appearance.theme", value: "dark" }] },
};

/** 模型可见文本的表面规则。 */
function expectLegibleSurface(toolName: string, text: string): void {
  // 裸毫秒字段（totalMs / wallTimeMs / …）不得进入上下文
  expect(text, `${toolName} leaks a raw *Ms field`).not.toMatch(/"\w*Ms"\s*:/);
  // epoch 毫秒（13 位数字）同理——时间一律 ISO 或已格式化时长
  expect(text, `${toolName} leaks an epoch-ms number`).not.toMatch(/\b1[6-9]\d{11}\b/);
  // 单次工具结果的体积上界（read_chapter 分片 12k + JSON 包装的余量）
  expect(text.length, `${toolName} result exceeds the surface budget`).toBeLessThanOrEqual(16_000);
}

function resultText(result: AgentToolResult<unknown>): string {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("expected a text tool result");
  return content.text;
}

function toolNames(scope: ThreadScope): string[] {
  const { deps } = createInMemoryDeps(seed());
  return buildAgentTools(scope, deps).map((tool) => tool.name);
}

describe("tool surface contract", () => {
  const globalScope: ThreadScope = { kind: "global", threadId: "surface-thread" };
  const bookScope: ThreadScope = { kind: "book", bookId: BOOK_ID };

  test("every registered tool has a surface case", () => {
    const registered = new Set([...toolNames(globalScope), ...toolNames(bookScope)]);
    const missing = [...registered].filter((name) => !(name in SURFACE_CASES));
    const stale = Object.keys(SURFACE_CASES).filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  for (const scope of [globalScope, bookScope]) {
    test(`${scope.kind} scope tools emit legible, bounded text`, async () => {
      const names = toolNames(scope);
      for (const name of names) {
        const params = SURFACE_CASES[name];
        if (!params) continue; // 完备性由上面的用例把守
        // 每个工具独立的 fixture：破坏性工具（fixture 自动批准权限）不得污染后续用例
        const { deps } = createInMemoryDeps(seed());
        const tool = buildAgentTools(scope, deps).find(
          (candidate: AgentTool) => candidate.name === name,
        );
        if (!tool) throw new Error(`${name} was not registered`);
        const result = await tool.execute(`surface-${name}`, params);
        expectLegibleSurface(name, resultText(result));
      }
    });
  }

  test("get_reading_stats presents durations, not milliseconds", async () => {
    const { deps } = createInMemoryDeps(seed());
    const tool = buildAgentTools(globalScope, deps).find(
      (candidate) => candidate.name === "get_reading_stats",
    );
    if (!tool) throw new Error("get_reading_stats was not registered");
    const text = resultText(await tool.execute("surface-stats", {}));
    expect(text).toContain("1h 30m");
    expect(text).not.toContain("5427000");
  });
});
