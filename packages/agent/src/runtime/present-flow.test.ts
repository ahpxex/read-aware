/**
 * 卡片管线（present_* / 带卡片的 extra tool → reference chunk）的端到端流
 * 测试：校验水合、ack 语义（skippedUnknown 不 throw）、details → chunk 的
 * 转换。查词卡片经由 extraTools 注入 —— 与产品侧的插件桥同一形状（词典
 * 工具由 Dictionary 插件注册，不再内置）。
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { DictionaryEntrySnapshot, Id } from "@read-aware/core";
import type { ThreadChunk, WordReference } from "../chunks";
import type { BookOverview, RuntimeDeps } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOKS: BookOverview[] = [
  { id: "b1" as Id, title: "Debt: The First 5000 Years", author: "David Graeber" },
  { id: "b2" as Id, title: "Sapiens", author: "Yuval Noah Harari" },
];

const SERENDIPITY: DictionaryEntrySnapshot = {
  headword: "serendipity",
  pronunciation: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/",
  senses: [
    { partOfSpeech: "noun", definition: "a happy accident", examples: ["Pure serendipity."] },
  ],
  etymology: "coined by Horace Walpole after the tale of the three princes of Serendip",
};


const noopComplete = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

function makeThread(scope: ThreadScope, deps: RuntimeDeps, model: Model<Api>) {
  return new AgentThread({
    scope,
    deps,
    resolveModel: () => model,
    getApiKey: () => "test-key",
    completeFn: noopComplete,
    streamFn: streamSimple,
  });
}

async function collect(iterable: AsyncIterable<ThreadChunk>): Promise<ThreadChunk[]> {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

function references(chunks: ThreadChunk[]) {
  return chunks.filter(
    (chunk): chunk is Extract<ThreadChunk, { type: "reference" }> => chunk.type === "reference",
  );
}

describe("present flow", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): { faux: FauxProviderRegistration; model: Model<Api> } {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return { faux, model: faux.getModel() as Model<Api> };
  }

  afterEach(() => {
    faux?.unregister();
  });

  test("present_books validates ids, hydrates snapshots, emits one reference chunk", async () => {
    const { faux, model } = makeFaux();
    let secondRound: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("present_books", { bookIds: ["b1", "nope", "b1"] })], {
        stopReason: "toolUse",
      }),
      (context) => {
        secondRound = context;
        return fauxAssistantMessage("Here it is.");
      },
    ]);
    const { deps } = createInMemoryDeps({ books: BOOKS });
    const thread = makeThread({ kind: "global", threadId: "present-books" }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "show me the book" }));

    const refs = references(chunks);
    expect(refs).toHaveLength(1);
    expect(refs[0].reference).toEqual({
      kind: "books",
      books: [{ bookId: "b1", title: "Debt: The First 5000 Years", author: "David Graeber" }],
    });
    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "end" && c.isError === false),
    ).toBe(true);
    // ack 让模型看到被跳过的未知 id
    const roundText = JSON.stringify(secondRound?.messages ?? []);
    expect(roundText).toContain("skippedUnknown");
    expect(roundText).toContain("nope");
  });

  test("present_books with only unknown ids acks without a reference chunk", async () => {
    const { faux, model } = makeFaux();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("present_books", { bookIds: ["nope"] })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Sorry, cannot find it."),
    ]);
    const { deps } = createInMemoryDeps({ books: BOOKS });
    const thread = makeThread({ kind: "global", threadId: "present-books" }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "show me" }));

    expect(references(chunks)).toHaveLength(0);
    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "end" && c.isError === false),
    ).toBe(true);
  });



  test("an extra tool's word card flows to a reference chunk with a visible tool step", async () => {
    const { faux, model } = makeFaux();
    let secondRound: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("plugin_dictionary_lookup_word", {
            term: "serendipity",
            context: "It was pure serendipity.",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        secondRound = context;
        return fauxAssistantMessage("A lovely word.");
      },
    ]);
    // 与 apps/web 插件桥（plugin-tools.ts）同形的工具结果：content 只带
    // 一句要义，完整词条走 details.reference。
    const lookupTool: AgentTool = {
      name: "plugin_dictionary_lookup_word",
      label: "Look up word",
      description: "Look up a word and show the reader a word card.",
      parameters: Type.Object({
        term: Type.String(),
        context: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const { term } = params as { term: string };
        const word: WordReference = {
          term,
          language: "English",
          entry: SERENDIPITY,
          source: "lookup",
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                presented: term,
                definition: SERENDIPITY.senses[0]?.definition,
              }),
            },
          ],
          details: { reference: { kind: "words", words: [word] } },
        };
      },
    };
    const { deps } = createInMemoryDeps({ books: BOOKS });
    deps.extraTools = () => [lookupTool];
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "what does serendipity mean?" }));

    expect(
      chunks.some(
        (c) =>
          c.type === "tool-step" &&
          c.phase === "start" &&
          c.tool === "plugin_dictionary_lookup_word",
      ),
    ).toBe(true);
    const payload = references(chunks)[0]?.reference;
    if (payload?.kind !== "words") throw new Error("expected a words payload");
    expect(payload.words[0].source).toBe("lookup");
    expect(payload.words[0].entry.etymology).toContain("Serendip");
    // 模型只拿一句要义，完整词条（词源等）不回流 —— 否则它会在正文里复述。
    // 只断言 toolResult 的 content（唯一上行 provider 的部分）；details 留在
    // pi 内部消息里供 UI/日志用，wire 转换不带它（openai-completions.js）。
    const toolResultText = (secondRound?.messages ?? [])
      .filter((message) => "role" in message && message.role === "toolResult")
      .flatMap((message) => (message as { content: Array<{ type: string; text?: string }> }).content)
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    expect(toolResultText).toContain("a happy accident");
    expect(toolResultText).not.toContain("Horace Walpole");
  });
});
