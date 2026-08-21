import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "../chunks";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

const BOOK_ID = "narrative-book" as Id;

async function collect(iterable: AsyncIterable<ThreadChunk>): Promise<ThreadChunk[]> {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

function narrativeDeps() {
  return createInMemoryDeps({
    books: [
      {
        id: BOOK_ID,
        title: "边界测试书",
        status: "reading",
        narrativity: "narrative",
      },
    ],
    chapters: {
      [BOOK_ID]: [
        { title: "眼前", text: "读者眼前只有红岸基地。" },
        {
          title: "后来",
          text: "不要回答。不要回答。不要回答。面壁计划开始，面壁计划继续，面壁计划结束。",
        },
      ],
    },
  });
}

describe("narrative output guard", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => faux?.unregister());

  test("holds an unsafe stream, rewrites it, and persists only the safe answer", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage("我不剧透，但原文是“不要回答”，之后还有面壁计划。"),
    ]);
    const { deps, stores } = narrativeDeps();
    let repairContext: Context | undefined;
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async (_model, context) => {
        repairContext = context;
        return fauxAssistantMessage("你目前只读到红岸基地；我先只解释眼前这段。 ");
      },
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "别剧透，讲讲我现在看到的内容。",
        readingCursor: {
          chapterIndex: 0,
          visibleText: "读者眼前只有红岸基地。",
        },
      }),
    );
    const shown = chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");

    expect(shown).toBe("你目前只读到红岸基地；我先只解释眼前这段。 ");
    expect(shown).not.toContain("不要回答");
    expect(shown).not.toContain("面壁计划");
    expect(JSON.stringify(repairContext)).toContain("forbiddenMaterial");
    const persisted = stores.turns.get(`book:${BOOK_ID}`) ?? [];
    expect(persisted[persisted.length - 1]?.content).toBe(shown);
  });

  test("a successful explicit spoiler grant bypasses the output guard", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("read_chapter", { chapterIndex: 1, confirmSpoiler: true })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("后面会出现面壁计划。"),
    ]);
    const { deps } = narrativeDeps();
    let repairs = 0;
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async () => {
        repairs += 1;
        return fauxAssistantMessage("不应调用");
      },
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "可以剧透，后面发生什么？",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");

    expect(shown).toBe("后面会出现面壁计划。");
    expect(repairs).toBe(0);
  });

  test("a model cannot grant itself spoiler access", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("read_chapter", { chapterIndex: 1, confirmSpoiler: true })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("后面会出现面壁计划。"),
    ]);
    const { deps, stores } = narrativeDeps();
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async () => fauxAssistantMessage("不应调用"),
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "给我讲讲后面最著名的那段。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");

    expect(shown).toContain("明确说明可以剧透");
    expect(shown).not.toContain("面壁计划");
    const persisted = stores.turns.get(`book:${BOOK_ID}`) ?? [];
    expect(persisted[persisted.length - 1]?.content).toBe(shown);
  });

  test("removes a leaking teaser block while preserving the grounded answer", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage(
        "读到这里，能够确定的只有红岸基地这一条线。\n\n至于后面的“不要回答”和面壁计划，我先不说。",
      ),
    ]);
    const { deps } = narrativeDeps();
    let repairs = 0;
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async () => {
        repairs += 1;
        return fauxAssistantMessage("不应调用");
      },
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "只讲我读到的地方。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");

    expect(shown).toBe("读到这里，能够确定的只有红岸基地这一条线。");
    expect(repairs).toBe(0);
  });
});
