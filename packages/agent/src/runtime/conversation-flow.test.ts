/** Phase 3 部件的线程级测试：滚动摘要、原话检索、跨书洞察工具。 */
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
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOK: ThreadScope = { kind: "book", bookId: "b1" as Id };
const GLOBAL: ThreadScope = { kind: "global" };

/** 后台管道的假补全：按 systemPrompt 区分提炼与摘要两类调用。 */
const pipelineComplete: CompleteFn = async (_model, context) =>
  context.systemPrompt?.includes("rolling summary")
    ? fauxAssistantMessage("摘要：读者在追问自由意志与利贝特实验。")
    : fauxAssistantMessage('{"new": [], "reinforced": []}');

describe("conversation flow", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): Model<Api> {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return faux.getModel() as Model<Api>;
  }

  afterEach(() => {
    faux?.unregister();
  });

  function makeThread(scope: ThreadScope, deps: ReturnType<typeof createInMemoryDeps>["deps"], model: Model<Api>) {
    return new AgentThread({
      scope,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: pipelineComplete,
    });
  }

  async function drain(thread: AgentThread, text: string): Promise<void> {
    for await (const _ of thread.sendTurn({ text })) {
      // drain
    }
  }

  test("rolling summary is stored after the turn and injected into the next prompt", async () => {
    const model = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage("回答一"),
      (context) => {
        captured = context;
        return fauxAssistantMessage("回答二");
      },
    ]);
    const { deps, stores } = createInMemoryDeps();
    const thread = makeThread(BOOK, deps, model);

    await drain(thread, "自由意志存在吗？");
    await thread.flushBackgroundWork();
    expect(stores.insights.get("book:b1")).toBe("摘要：读者在追问自由意志与利贝特实验。");

    await drain(thread, "继续");
    expect(captured?.systemPrompt).toContain("摘要：读者在追问自由意志与利贝特实验。");
  });

  test("search_conversation surfaces verbatim past turns", async () => {
    const model = makeFaux();
    let toolResultPayload = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("search_conversation", { query: "利贝特" })], {
        stopReason: "toolUse",
      }),
      (context) => {
        toolResultPayload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("找到了");
      },
    ]);
    const { deps, stores } = createInMemoryDeps();
    stores.turns.set("book:b1", [
      { role: "user", content: "有什么著名实验？", createdAt: "2026-06-01T00:00:00Z" },
      {
        role: "assistant",
        content: "最著名的是利贝特实验：准备电位早于报告的意图约 350 毫秒。",
        createdAt: "2026-06-01T00:00:05Z",
      },
    ]);
    const thread = makeThread(BOOK, deps, model);

    await drain(thread, "你上次说的那个实验叫什么来着？");

    expect(toolResultPayload).toContain("利贝特实验");
    expect(toolResultPayload).toContain("350");
  });

  test("get_conversation_insights lets the global thread read a book thread's summary", async () => {
    const model = makeFaux();
    let toolResultPayload = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("get_conversation_insights", { bookId: "b1" })], {
        stopReason: "toolUse",
      }),
      (context) => {
        toolResultPayload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("好的");
      },
    ]);
    const { deps, stores } = createInMemoryDeps();
    stores.insights.set("book:b1", "这本书的对话围绕货币的政治属性展开。");
    const thread = makeThread(GLOBAL, deps, model);

    await drain(thread, "我在那本书里聊过什么？");

    expect(toolResultPayload).toContain("货币的政治属性");
  });
});
