import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import type { BookTextHit } from "../ports";
import {
  buildGroundingContext,
  precedingWindow,
  renderGroundingContext,
  selectionQueries,
} from "./grounding-context";

const BOOK_ID = "book-1" as Id;

const CHAPTER = [
  "第五章 对话",
  "",
  "阿辽沙走进屋子的时候，伊万正靠在窗边。两人沉默了很久。",
  "伊万开口说：'人是软弱的，他们要的不是自由，而是有人替他们做主。'",
  "阿辽沙没有回答。窗外的雪停了。",
  "他接着说：'如今人们比任何时候都相信自己自由，其实自由早已交了出去。'",
  "阿辽沙终于抬起头，眼里含着泪。",
  "后文：这一段读者还没有读到，不应出现在任何接地材料里。",
].join("\n");

const SELECTION = "如今人们比任何时候都相信自己自由，其实自由早已交了出去。";
const VISIBLE = CHAPTER.slice(
  CHAPTER.indexOf("伊万开口说"),
  CHAPTER.indexOf(SELECTION) + SELECTION.length + "'".length,
);

function bookTextStub(overrides?: {
  chapterText?: string | undefined;
  hits?: BookTextHit[];
  onSearch?: (filter: { queries: string[]; throughChapterIndex?: number }) => void;
}) {
  return {
    getChapterText: async () => overrides?.chapterText ?? CHAPTER,
    searchText: async (filter: {
      queries: string[];
      bookId?: Id;
      throughChapterIndex?: number;
      limit?: number;
    }) => {
      overrides?.onSearch?.(filter);
      return overrides?.hits ?? [];
    },
  };
}

describe("selectionQueries", () => {
  test("keeps the full selection and long distinctive tokens", () => {
    const queries = selectionQueries(SELECTION);
    expect(queries[0]).toBe(SELECTION);
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries.slice(1)) {
      expect(query.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("precedingWindow", () => {
  test("window ends where the viewport begins, never duplicating visible text", () => {
    const window = precedingWindow(CHAPTER, SELECTION, VISIBLE);
    expect(window).toBeDefined();
    expect(window).toContain("阿辽沙走进屋子");
    expect(window).not.toContain("伊万开口说");
    expect(window).not.toContain("后文");
  });

  test("falls back to the selection position when the viewport cannot be located", () => {
    const window = precedingWindow(CHAPTER, SELECTION, "阅读器 DOM 里完全对不上的文本片段啊啊啊");
    expect(window).toBeDefined();
    expect(window).toContain("人是软弱的");
    expect(window).not.toContain("后文");
  });

  test("returns undefined when nothing can be located", () => {
    expect(precedingWindow(CHAPTER, "这段话不在书里", undefined)).toBeUndefined();
  });
});

describe("buildGroundingContext", () => {
  test("narrative fence searches strictly earlier chapters only", async () => {
    let searched: { queries: string[]; throughChapterIndex?: number } | undefined;
    const context = await buildGroundingContext({
      bookText: bookTextStub({
        onSearch: (filter) => {
          searched = filter;
        },
        hits: [
          {
            bookId: BOOK_ID,
            chapterIndex: 2,
            chapterTitle: "第三章",
            snippet: "更早章节的命中片段",
            offset: 10,
            match: "exact",
          },
        ],
      }),
      bookId: BOOK_ID,
      attachments: [{ text: SELECTION }],
      cursor: { chapterIndex: 5, visibleText: VISIBLE },
      narrativeFence: true,
    });
    expect(searched?.throughChapterIndex).toBe(4);
    expect(context).toContain("<grounding_context>");
    expect(context).toContain("earlier_this_chapter");
    expect(context).toContain("更早章节的命中片段");
    expect(context).not.toContain("后文");
  });

  test("narrative book without a chapter coordinate assembles nothing", async () => {
    const context = await buildGroundingContext({
      bookText: bookTextStub(),
      bookId: BOOK_ID,
      attachments: [{ text: SELECTION }],
      cursor: { visibleText: VISIBLE },
      narrativeFence: true,
    });
    expect(context).toBeUndefined();
  });

  test("first chapter of a fenced book skips search but keeps the preceding window", async () => {
    let searchCalled = false;
    const context = await buildGroundingContext({
      bookText: bookTextStub({
        onSearch: () => {
          searchCalled = true;
        },
      }),
      bookId: BOOK_ID,
      attachments: [{ text: SELECTION }],
      cursor: { chapterIndex: 0, visibleText: VISIBLE },
      narrativeFence: true,
    });
    expect(searchCalled).toBe(false);
    expect(context).toContain("earlier_this_chapter");
  });

  test("unfenced book searches the whole book but drops current-chapter hits", async () => {
    let searched: { throughChapterIndex?: number } | undefined;
    const context = await buildGroundingContext({
      bookText: bookTextStub({
        onSearch: (filter) => {
          searched = filter;
        },
        hits: [
          {
            bookId: BOOK_ID,
            chapterIndex: 5,
            snippet: "当前章自己的命中",
            offset: 1,
            match: "exact",
          },
          {
            bookId: BOOK_ID,
            chapterIndex: 9,
            snippet: "后面章节的命中（说明书允许）",
            offset: 1,
            match: "exact",
          },
        ],
      }),
      bookId: BOOK_ID,
      attachments: [{ text: SELECTION }],
      cursor: { chapterIndex: 5, visibleText: VISIBLE },
      narrativeFence: false,
    });
    expect(searched?.throughChapterIndex).toBeUndefined();
    expect(context).not.toContain("当前章自己的命中");
    expect(context).toContain("后面章节的命中");
  });

  test("port failure degrades to no block instead of throwing", async () => {
    const context = await buildGroundingContext({
      bookText: {
        getChapterText: async () => {
          throw new Error("not extracted");
        },
        searchText: async () => {
          throw new Error("not extracted");
        },
      },
      bookId: BOOK_ID,
      attachments: [{ text: SELECTION }],
      cursor: { chapterIndex: 5 },
      narrativeFence: true,
    });
    expect(context).toBeUndefined();
  });

  test("no selection attachment means no block", async () => {
    const context = await buildGroundingContext({
      bookText: bookTextStub(),
      bookId: BOOK_ID,
      attachments: [{ text: "   " }],
      cursor: { chapterIndex: 5 },
      narrativeFence: false,
    });
    expect(context).toBeUndefined();
  });
});

describe("renderGroundingContext", () => {
  test("returns undefined when there is no material", () => {
    expect(renderGroundingContext({ hits: [] })).toBeUndefined();
  });

  test("keeps the block within budget by dropping overflow hits", () => {
    const bigHit = (index: number): BookTextHit => ({
      bookId: BOOK_ID,
      chapterIndex: index,
      snippet: "长".repeat(700),
      offset: 0,
      match: "exact",
    });
    const block = renderGroundingContext({
      precedingText: "短前文",
      precedingChapterIndex: 3,
      hits: [bigHit(0), bigHit(1), bigHit(2), bigHit(3), bigHit(4)],
    });
    expect(block).toBeDefined();
    expect(block!.length).toBeLessThan(3400);
  });
});
