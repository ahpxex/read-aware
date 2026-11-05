import { afterEach, describe, expect, test } from "bun:test";
import { modelRequestView, type ModelRequestView } from "./transcript";
import type { Api, Model } from "@earendil-works/pi-ai";
import { messageText } from "../testing/message-text";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "../chunks";
import { createInMemoryDeps } from "../testing/fixtures";
import { hostTurn } from "../testing/transcript-host";
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

  test("holds an unsafe stream and rewrites it, so the host can only record the safe answer", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([fauxAssistantMessage("我不剧透，但原文是“不要回答”，之后还有面壁计划。")]);
    const { deps, stores } = narrativeDeps();
    let repairContext: ModelRequestView | undefined;
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async (_model, context) => {
        repairContext = modelRequestView(context);
        return fauxAssistantMessage("你目前只读到红岸基地；我先只解释眼前这段。 ");
      },
      streamFn: streamSimple,
    });

    const chunks = await collect(
      hostTurn(stores.turns, thread, {
        text: "别剧透，讲讲我现在看到的内容。",
        readingCursor: {
          chapterIndex: 0,
          visibleText: "读者眼前只有红岸基地。",
        },
      }),
    );
    const shown = chunks
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");

    expect(shown).toBe("你目前只读到红岸基地；我先只解释眼前这段。 ");
    expect(shown).not.toContain("不要回答");
    expect(shown).not.toContain("面壁计划");
    expect(JSON.stringify(repairContext)).toContain("forbiddenMaterial");
    const persisted = stores.turns.get(`book:${BOOK_ID}`) ?? [];
    expect(persisted[persisted.length - 1]?.content).toBe(shown);
  });

  test("gives repair bounded transcript context without promoting private evidence", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([fauxAssistantMessage("后来原文是“不要回答”。")]);
    const { deps, stores } = narrativeDeps();
    const turns = Array.from({ length: 7 }, (_, index) => [
      { role: "user" as const, content: `旧问题 ${index}`, createdAt: `2026-06-0${index + 1}T00:00:00Z` },
      {
        role: "assistant" as const,
        content: `旧回答 ${index} 围绕红岸基地`,
        createdAt: `2026-06-0${index + 1}T00:00:05Z`,
      },
    ]).flat();
    turns[turns.length - 1] = {
      role: "assistant",
      content: "后来原文是“不要回答”。",
      createdAt: "2026-06-07T00:00:05Z",
    };
    stores.turns.set(`book:${BOOK_ID}`, turns);
    stores.annotations.push({
      id: "annotation-1" as Id,
      bookId: BOOK_ID,
      kind: "highlight",
      text: "私密批注：不要注入重写上下文",
      color: "yellow",
      style: "highlight",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    });
    stores.memories.push({
      id: "memory-1",
      scope: `book:${BOOK_ID}`,
      kind: "insight",
      content: "私密记忆：不要注入重写上下文。",
      importance: 0.5,
      evidenceCount: 1,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    });
    let repairContext: ModelRequestView | undefined;
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async (_model, context) => {
        repairContext = modelRequestView(context);
        return fauxAssistantMessage("只围绕红岸基地回顾。");
      },
      streamFn: streamSimple,
    });

    await collect(
      thread.sendTurn({
        text: "回顾眼前内容。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );

    const payload = JSON.parse(messageText(repairContext?.messages[0]));
    expect(payload.recentTurns).toHaveLength(12);
    expect(payload.recentTurns[0].content).toBe("旧问题 1");
    expect(payload.recentTurns.at(-1).content).toBe("后来原文是“不要回答”。");
    expect(payload).not.toHaveProperty("verifiedSessionEvidence");
    expect(JSON.stringify(repairContext)).not.toContain("私密批注");
    expect(JSON.stringify(repairContext)).not.toContain("私密记忆");
  });

  test("keeps a bounded recent history when a guard repair rebuilds the agent", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    let rebuiltContext: ModelRequestView | undefined;
    faux.setResponses([
      fauxAssistantMessage("后来原文是“不要回答”。"),
      (context) => {
        rebuiltContext = modelRequestView(context);
        return fauxAssistantMessage("继续围绕眼前内容。");
      },
    ]);
    const { deps, stores } = narrativeDeps();
    stores.turns.set(
      `book:${BOOK_ID}`,
      Array.from({ length: 7 }, (_, index) => [
        { role: "user" as const, content: `旧问题 ${index}`, createdAt: `2026-06-0${index + 1}T00:00:00Z` },
        { role: "assistant" as const, content: `旧回答 ${index}`, createdAt: `2026-06-0${index + 1}T00:00:05Z` },
      ]).flat(),
    );
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async () => fauxAssistantMessage("当前只讨论眼前内容。"),
      streamFn: streamSimple,
    });

    const cursor = { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" };
    await collect(hostTurn(stores.turns, thread, { text: "先回答这个。", readingCursor: cursor }));
    await collect(hostTurn(stores.turns, thread, { text: "再继续。", readingCursor: cursor }));

    const rebuilt = JSON.stringify(rebuiltContext?.messages ?? []);
    expect(rebuilt).toContain("旧问题 2");
    expect(rebuilt).toContain("旧问题 6");
    expect(rebuilt).not.toContain("旧问题 0");
  });

  test("a successful explicit spoiler grant bypasses the output guard", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1, confirmSpoiler: true })], {
        stopReason: "toolUse",
      }),
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
    const shown = chunks
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");

    expect(shown).toBe("后面会出现面壁计划。");
    expect(repairs).toBe(0);
  });

  test("a model cannot grant itself spoiler access", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1, confirmSpoiler: true })], {
        stopReason: "toolUse",
      }),
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
      hostTurn(stores.turns, thread, {
        text: "给我讲讲后面最著名的那段。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");

    expect(shown).toContain("明确说明可以剧透");
    expect(shown).not.toContain("面壁计划");
    const persisted = stores.turns.get(`book:${BOOK_ID}`) ?? [];
    expect(persisted[persisted.length - 1]?.content).toBe(shown);
  });

  test("rewrites a leaking teaser while preserving the grounded answer", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage("读到这里，能够确定的只有红岸基地这一条线。\n\n至于后面的“不要回答”和面壁计划，我先不说。"),
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
        return fauxAssistantMessage("读到这里，能够确定的只有红岸基地这一条线。");
      },
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "只讲我读到的地方。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");

    expect(shown).toBe("读到这里，能够确定的只有红岸基地这一条线。");
    expect(repairs).toBe(1);
  });

  test("does not publish a hollow section after removing its unsafe body", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([
      fauxAssistantMessage(
        "眼前的地点是红岸基地，这也是当前阅读位置已经明确交代的内容。\n\n## 主要线索\n\n后来原文写道“不要回答”。\n\n## 当前地点\n\n红岸基地。",
      ),
    ]);
    const { deps, stores } = narrativeDeps();
    let repairs = 0;
    const replacement = "当前明确的线索只有红岸基地；已提供的内容尚不足以列出更多线索。";
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      repairCompleteFn: async () => {
        repairs++;
        return fauxAssistantMessage(replacement);
      },
      streamFn: streamSimple,
    });
    const chunks = await collect(
      hostTurn(stores.turns, thread, {
        text: "梳理已读到的主要线索。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const shown = chunks
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");
    expect(repairs).toBe(1);
    expect(shown).toBe(replacement);
    const persisted = stores.turns.get(`book:${BOOK_ID}`) ?? [];
    expect(persisted[persisted.length - 1]?.content).toBe(replacement);
  });
});
