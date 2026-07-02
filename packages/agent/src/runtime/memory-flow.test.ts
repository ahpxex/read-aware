/** 记忆写路径的线程级集成测试：提炼落库、强化、ask-note、注入、remember 工具。 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOK: ThreadScope = { kind: "book", bookId: "b1" as Id };
const GLOBAL: ThreadScope = { kind: "global" };

describe("memory write path", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): Model<Api> {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return faux.getModel() as Model<Api>;
  }

  afterEach(() => {
    faux?.unregister();
  });

  function makeThread(
    scope: ThreadScope,
    deps: RuntimeDeps,
    model: Model<Api>,
    completeFn: CompleteFn,
  ) {
    return new AgentThread({
      scope,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn,
    });
  }

  async function drain(thread: AgentThread, text: string, extra?: object): Promise<void> {
    for await (const _ of thread.sendTurn({ text, ...extra })) {
      // drain
    }
  }

  test("extraction saves new memories and reinforces known ones", async () => {
    const model = makeFaux();
    faux.setResponses([fauxAssistantMessage("答案")]);
    const { deps, stores } = createInMemoryDeps({
      memories: [seedMemory({ id: "mem-1", scope: "user", content: "偏好深挖" })],
    });
    const completeFn: CompleteFn = async () =>
      fauxAssistantMessage(
        '{"new": [{"scope": "book", "kind": "insight", "content": "货币先于铸币出现"}], "reinforced": ["mem-1"]}',
      );
    const thread = makeThread(BOOK, deps, model, completeFn);

    await drain(thread, "这章讲什么？");
    await thread.flushBackgroundWork();

    expect(stores.savedMemoryInputs).toEqual([
      {
        scope: "book:b1",
        kind: "insight",
        content: "货币先于铸币出现",
        origin: "extraction",
        sourceThreadKey: "book:b1",
      },
    ]);
    const reinforced = stores.memories.find((m) => m.id === "mem-1");
    expect(reinforced?.evidenceCount).toBe(2);
  });

  test("ask-notes anchor at the selection, else the reading position; global thread leaves none", async () => {
    const model = makeFaux();
    faux.setResponses([
      fauxAssistantMessage("回答一"),
      fauxAssistantMessage("回答二"),
      fauxAssistantMessage("回答三"),
    ]);
    const { deps, stores } = createInMemoryDeps();
    const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');
    const bookThread = makeThread(BOOK, deps, model, noop);
    const globalThread = makeThread(GLOBAL, deps, model, noop);

    await drain(bookThread, "这段怎么理解？", {
      attachments: [{ text: "原文", anchor: "epubcfi(/6/4!/2)", chapter: "第二章" }],
      positionAnchor: "epubcfi(/6/8!/1)",
    });
    await drain(bookThread, "换个角度呢？", { positionAnchor: "epubcfi(/6/8!/1)" });
    await drain(globalThread, "书架总览？");

    expect(stores.asks).toEqual([
      { bookId: "b1", question: "这段怎么理解？", anchor: "epubcfi(/6/4!/2)", chapter: "第二章" },
      { bookId: "b1", question: "换个角度呢？", anchor: "epubcfi(/6/8!/1)", chapter: undefined },
    ]);
  });

  test("stored memories are injected into the system prompt", async () => {
    const model = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("好的");
      },
    ]);
    const { deps } = createInMemoryDeps({
      memories: [seedMemory({ id: "mem-1", scope: "user", kind: "preference", content: "读者偏好第一性原理讲解" })],
    });
    const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');
    const thread = makeThread(BOOK, deps, model, noop);

    await drain(thread, "继续");

    expect(captured?.systemPrompt).toContain("读者偏好第一性原理讲解");
  });

  test("the remember tool writes immediately within the turn", async () => {
    const model = makeFaux();
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("remember", { content: "读者的阅读目标是理解货币史", scope: "user", kind: "fact" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("记住了。"),
    ]);
    const { deps, stores } = createInMemoryDeps();
    const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');
    const thread = makeThread(BOOK, deps, model, noop);

    await drain(thread, "记住：我想搞懂货币史");

    expect(stores.savedMemoryInputs).toContainEqual({
      scope: "user",
      kind: "fact",
      content: "读者的阅读目标是理解货币史",
      origin: "agent",
      sourceThreadKey: "book:b1",
    });
  });

  test("search_memory feeds stored memories back to the model", async () => {
    const model = makeFaux();
    let toolResultPayload = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("search_memory", { query: "刨根" })], {
        stopReason: "toolUse",
      }),
      (context) => {
        toolResultPayload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("找到了");
      },
    ]);
    const { deps } = createInMemoryDeps({
      memories: [seedMemory({ id: "mem-1", scope: "user", content: "读者喜欢刨根问底" })],
    });
    const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');
    const thread = makeThread(BOOK, deps, model, noop);

    await drain(thread, "你还记得我什么？");

    expect(toolResultPayload).toContain("刨根问底");
  });
});
