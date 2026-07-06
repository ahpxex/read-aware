/** 正文工具：目录、分片读章、全文检索（agent 迭代检索替代向量的读端）。 */
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
import { AgentThread } from "./thread";

const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

const CHAPTERS = {
  b1: [
    // 12k 窗口下仍要分片，正文得够长
    { title: "第一章", text: "货币起源于债务记账。" + "填充".repeat(8000) },
    { title: "第二章", text: "物物交换神话在田野记录中从未被观察到。" },
  ],
};

describe("book text tools", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => {
    faux?.unregister();
  });

  function setup(responses: Parameters<FauxProviderRegistration["setResponses"]>[0]) {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses(responses);
    const { deps, stores } = createInMemoryDeps({ chapters: CHAPTERS });
    const thread = new AgentThread({
      scope: { kind: "book", bookId: "b1" as Id },
      deps,
      resolveModel: () => model,
      getApiKey: () => "k",
      completeFn: noop,
    });
    return { thread, stores };
  }

  async function drain(thread: AgentThread, text: string) {
    for await (const _ of thread.sendTurn({ text })) {
      // drain
    }
  }

  test("get_toc and windowed read_chapter reach the model", async () => {
    let tocPayload = "";
    let chapterPayload = "";
    const { thread } = setup([
      fauxAssistantMessage([fauxToolCall("get_toc", {})], { stopReason: "toolUse" }),
      (context: Context) => {
        tocPayload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 0, part: 0 })], {
          stopReason: "toolUse",
        });
      },
      (context: Context) => {
        chapterPayload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("读到了。");
      },
    ]);

    await drain(thread, "这本书目录是什么？第一章开头讲什么？");

    expect(tocPayload).toContain("第一章");
    expect(chapterPayload).toContain("货币起源于债务记账");
    expect(chapterPayload).toContain("totalParts");
    const parsed = JSON.parse(chapterPayload) as { content?: Array<{ text?: string }> };
    const result = JSON.parse(parsed.content?.[0]?.text ?? "{}") as { totalParts?: number };
    expect((result.totalParts ?? 0) > 1).toBe(true); // 长章节确实被分片
  });

  test("search_book_text finds prose with a snippet", async () => {
    let payload = "";
    const { thread } = setup([
      fauxAssistantMessage(
        [fauxToolCall("search_book_text", { queries: ["物物交换", "以物易物"] })],
        { stopReason: "toolUse" },
      ),
      (context: Context) => {
        payload = JSON.stringify(context.messages[context.messages.length - 1]);
        return fauxAssistantMessage("找到了。");
      },
    ]);

    await drain(thread, "书里哪里提到物物交换？");

    expect(payload).toContain("物物交换神话");
    expect(payload).toContain("chapterIndex");
  });
});
