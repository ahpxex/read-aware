import { afterEach, describe, expect, test } from "bun:test";
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
import { SPOILER_ACCESS_TOOL } from "../tools/spoiler-access";

const BOOK_ID = "narrative-book" as Id;

async function collect(iterable: AsyncIterable<ThreadChunk>): Promise<ThreadChunk[]> {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

function narrativeDeps(spoilerAccess?: "approve" | "decline") {
  return createInMemoryDeps({
    spoilerAccess,
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

describe("narrative reading fence in a turn", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => faux?.unregister());

  test("the answer streams as the model writes it", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000, tokenSize: { min: 1, max: 2 } });
    const model = faux.getModel() as Model<Api>;
    const answer = "你目前读到的只有红岸基地这一处地点，这一页没有交代更多人物。";
    faux.setResponses([fauxAssistantMessage(answer)]);
    const { deps } = narrativeDeps();
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({
        text: "讲讲我现在看到的内容。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    const roundEnd = chunks.findIndex((chunk) => chunk.type === "metric");
    const streamed = chunks.slice(0, roundEnd).filter((chunk) => chunk.type === "text");
    expect(streamed.length).toBeGreaterThan(1);
    expect(streamed.map((chunk) => chunk.text).join("")).toBe(answer);
    thread.dispose();
  });

  test("a model cannot reach past the fence on its own", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    let toolResult = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1, confirmSpoiler: true })], {
        stopReason: "toolUse",
      }),
      (context) => {
        toolResult = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("这部分要等你读到再说。");
      },
    ]);
    const { deps, stores } = narrativeDeps();
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      streamFn: streamSimple,
    });

    await collect(
      hostTurn(stores.turns, thread, {
        text: "给我讲讲后面最著名的那段。",
        readingCursor: { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" },
      }),
    );
    expect(toolResult).not.toContain("不要回答");
    expect(toolResult).not.toContain("面壁计划");
    thread.dispose();
  });

  test("a reader inside a chapter: read_chapter returns that chapter up to their page, and the guard knows it", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    const chapter = "红岸基地建在雷达峰上。叶文洁第一次走进主控室。\n不要回答。不要回答。不要回答。面壁计划开始。";
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: BOOK_ID, title: "边界测试书", status: "reading", narrativity: "narrative" }],
      chapters: {
        [BOOK_ID]: [
          { title: "序", text: "序章只有风。" },
          { title: "红岸", text: chapter },
        ],
      },
    });
    let toolResult = "";
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = messageText(context.messages[context.messages.length - 1]!);
        return fauxAssistantMessage([fauxToolCall("read_chapter", { around: "position", context: 3 })], {
          stopReason: "toolUse",
        });
      },
      (context) => {
        toolResult = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("这一页写的是“叶文洁第一次走进主控室”。");
      },
    ]);
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      streamFn: streamSimple,
    });
    const page = "叶文洁第一次走进主控室。";
    const start = chapter.indexOf(page);
    const chunks = await collect(
      hostTurn(stores.turns, thread, {
        text: "这一页在讲什么？",
        // The host's viewport text is not what the model receives once the page is located.
        readingCursor: { chapterIndex: 1, position: { start, end: start + page.length }, visibleText: page },
      }),
    );
    expect(prompt).toContain("position: paragraph 0 sentence 1, of 2 paragraphs in this chapter");
    expect(prompt).not.toContain("叶文洁");
    expect(toolResult).toContain("叶文洁第一次走进主控室。");
    expect(toolResult).toContain("readerPosition");
    expect(toolResult).not.toContain("不要回答");
    expect(
      chunks
        .filter((chunk) => chunk.type === "text")
        .map((chunk) => chunk.text)
        .join(""),
    ).toBe("这一页写的是“叶文洁第一次走进主控室”。");
    thread.dispose();
  });
  const cursor = { chapterIndex: 0, visibleText: "读者眼前只有红岸基地。" };
  const lastToolResult = (context: { messages: unknown[] }) =>
    JSON.stringify(context.messages[context.messages.length - 1]);

  test("the reader's approval opens later chapters for this reply only", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    const results: string[] = [];
    let nextTurnContext = "";
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(SPOILER_ACCESS_TOOL, { topic: "后面发生什么" }),
          fauxToolCall("read_chapter", { chapterIndex: 1 }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        results.push(lastToolResult(context));
        return fauxAssistantMessage("后面会出现面壁计划。");
      },
      (context) => {
        nextTurnContext = JSON.stringify(context.messages);
        return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })], { stopReason: "toolUse" });
      },
      (context) => {
        results.push(lastToolResult(context));
        return fauxAssistantMessage("这部分要等你读到。");
      },
    ]);
    const { deps, stores } = narrativeDeps("approve");
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      streamFn: streamSimple,
    });

    await collect(hostTurn(stores.turns, thread, { text: "可以剧透，后面发生什么？", readingCursor: cursor }));
    expect(stores.interactions).toEqual([expect.objectContaining({ action: "reveal-spoilers" })]);
    expect(results[0]).toContain("面壁计划");
    // The next message starts behind the fence again, and the later text the approved
    // reply read does not carry over: only the answer the reader was shown does.
    await collect(hostTurn(stores.turns, thread, { text: "再讲讲后面。", readingCursor: cursor }));
    expect(nextTurnContext).toContain("后面会出现面壁计划。");
    expect(nextTurnContext).not.toContain("不要回答");
    expect(results[1]).not.toContain("面壁计划");
    expect(results[1]).toContain(SPOILER_ACCESS_TOOL);
    thread.dispose();
  });

  test("a retried reply keeps the approval it already has, without asking again", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    let retried = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(SPOILER_ACCESS_TOOL, { topic: "后面发生什么" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("INCOMPLETE", { stopReason: "error", errorMessage: "Connection error." }),
      fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })], { stopReason: "toolUse" }),
      (context) => {
        retried = lastToolResult(context);
        return fauxAssistantMessage("后面会出现面壁计划。");
      },
    ]);
    const { deps, stores } = narrativeDeps("approve");
    const thread = new AgentThread({
      scope: { kind: "book", bookId: BOOK_ID },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
      streamFn: streamSimple,
    });
    const input = { text: "可以剧透，后面发生什么？", readingCursor: cursor, turnId: "user-1" };
    await expect(collect(hostTurn(stores.turns, thread, input))).rejects.toMatchObject({ code: "ai/network" });
    await collect(hostTurn(stores.turns, thread, { ...input, retry: true }));
    expect(retried).toContain("面壁计划");
    expect(stores.interactions).toHaveLength(1);
    thread.dispose();
  });
});
