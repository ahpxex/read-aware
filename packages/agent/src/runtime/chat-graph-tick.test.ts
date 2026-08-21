/**
 * 聊天驱动的图谱补建：存量用户换新 agent 后发的第一条消息起，书线程的
 * 轮后管道每轮为当前书补建一批纪要（聊哪本书，哪本书的图就优先追平），
 * 账清之后节拍变为纯读空转。分类先行：未分类的书先分类落库再定口径。
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOK: ThreadScope = { kind: "book", bookId: "b1" as Id };

describe("chat-driven graph catch-up", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): Model<Api> {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return faux.getModel() as Model<Api>;
  }

  afterEach(() => {
    faux?.unregister();
  });

  /** 按提示词分派 fast 调用：分类 / 单章纪要 / 其余（提炼、摘要）。 */
  function fastStub(log: string[]): CompleteFn {
    return async (_model, context) => {
      const system = String(context.systemPrompt ?? "");
      if (system.includes("NARRATIVE work or an EXPOSITORY work")) {
        log.push("classify");
        return fauxAssistantMessage('{"narrativity": "expository", "confidence": 0.9}');
      }
      if (system.includes("Digest ONE chapter")) {
        const match = String(context.messages[0]?.content ?? "").match(/Chapter #(\d+)/);
        log.push(`digest:${match?.[1]}`);
        return fauxAssistantMessage(
          '{"summary": "本章要点。", "concepts": [{"name": "概念"}], "relations": []}',
        );
      }
      log.push("other");
      return fauxAssistantMessage('{"new": [], "reinforced": []}');
    };
  }

  test("each book-thread turn digests a budgeted batch until the backlog clears", async () => {
    const model = makeFaux();
    faux.setResponses([
      fauxAssistantMessage("答一"),
      fauxAssistantMessage("答二"),
      fauxAssistantMessage("答三"),
    ]);
    const log: string[] = [];
    const { deps, stores } = createInMemoryDeps({
      // 未分类的存量书：读到第 4 章（index 3），纪要欠账 3 章（0/1/2）。
      books: [{ id: "b1" as Id, title: "存量书", status: "reading", progressPercent: 40 }],
      chapters: {
        b1: [0, 1, 2, 3].map((index) => ({
          title: `第${index}章`,
          text: `第${index}章正文……`,
          hrefs: [`ch${index}.html`],
        })),
      },
    });
    const thread = new AgentThread({
      scope: BOOK,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: fastStub(log),
      streamFn: streamSimple,
    });
    const drain = async (text: string) => {
      for await (const _ of thread.sendTurn({
        text,
        readingCursor: { chapter: "ch3.html" },
      })) {
        // drain
      }
      await thread.flushBackgroundWork();
    };

    await drain("第一条消息。");
    // 第一轮：先分类（一次性落库），再按每轮 2 章的预算补 0、1
    expect(log.filter((entry) => entry === "classify")).toHaveLength(1);
    expect(log.filter((entry) => entry.startsWith("digest:"))).toEqual(["digest:0", "digest:1"]);
    expect(stores.books[0]?.narrativity).toBe("expository");

    await drain("第二条消息。");
    // 第二轮：分类已落库不再跑；补最后一章，账清
    expect(log.filter((entry) => entry === "classify")).toHaveLength(1);
    expect(log.filter((entry) => entry.startsWith("digest:"))).toEqual([
      "digest:0",
      "digest:1",
      "digest:2",
    ]);
    const digests = stores.chapterDigests.get("b1") ?? [];
    expect(digests.map((digest) => digest.chapterIndex).sort()).toEqual([0, 1, 2]);
    expect(digests.every((digest) => digest.flavor === "expository")).toBe(true);

    await drain("第三条消息。");
    // 账已清：节拍空转，零新增 LLM 纪要调用
    expect(log.filter((entry) => entry.startsWith("digest:"))).toHaveLength(3);
  });

  test("without a live cursor the tick falls back to the book's progress chapterHref", async () => {
    const model = makeFaux();
    faux.setResponses([fauxAssistantMessage("答")]);
    const log: string[] = [];
    const { deps } = createInMemoryDeps({
      books: [
        {
          id: "b1" as Id,
          title: "存量书",
          status: "reading",
          narrativity: "narrative",
        },
      ],
      bookStats: [
        {
          bookId: "b1" as Id,
          progressPercent: 40,
          status: "reading",
          chapterHref: "ch2.html",
          totalMs: 0,
          daily: {},
        },
      ],
      chapters: {
        b1: [0, 1, 2].map((index) => ({
          title: `第${index}章`,
          text: `第${index}章正文……`,
          hrefs: [`ch${index}.html`],
        })),
      },
    });
    const thread = new AgentThread({
      scope: BOOK,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: fastStub(log),
      streamFn: streamSimple,
    });
    // 阅读器没开、消息不带游标——边界取自书的进度 chapterHref (ch2 → 补 0、1)
    for await (const _ of thread.sendTurn({ text: "没有游标的消息。" })) {
      // drain
    }
    await thread.flushBackgroundWork();
    expect(log.filter((entry) => entry.startsWith("digest:"))).toEqual(["digest:0", "digest:1"]);
  });
});
