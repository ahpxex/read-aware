/**
 * 卡片管线（present_* / lookup_word → reference chunk）的端到端流测试：
 * 校验水合、ack 语义（skippedUnknown 不 throw）、details → chunk 的转换。
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "../chunks";
import type { DictionaryEntry } from "../models/dictionary";
import type { BookOverview, RuntimeDeps, VocabularyEntry } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOKS: BookOverview[] = [
  { id: "b1" as Id, title: "Debt: The First 5000 Years", author: "David Graeber" },
  { id: "b2" as Id, title: "Sapiens", author: "Yuval Noah Harari" },
];

const SERENDIPITY: DictionaryEntry = {
  headword: "serendipity",
  pronunciation: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/",
  senses: [
    { partOfSpeech: "noun", definition: "a happy accident", examples: ["Pure serendipity."] },
  ],
  etymology: "coined by Horace Walpole after the tale of the three princes of Serendip",
};

const VOCABULARY: VocabularyEntry[] = [
  {
    term: "Serendipity",
    language: "English",
    definition: "a happy accident",
    addedAt: "2026-06-01T00:00:00Z",
    entry: SERENDIPITY,
  },
  {
    term: "ephemeral",
    language: "English",
    definition: "lasting a very short time",
    addedAt: "2026-06-02T00:00:00Z",
  },
];

const noopComplete = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

function makeThread(scope: ThreadScope, deps: RuntimeDeps, model: Model<Api>) {
  return new AgentThread({
    scope,
    deps,
    resolveModel: () => model,
    getApiKey: () => "test-key",
    completeFn: noopComplete,
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
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

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
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "show me" }));

    expect(references(chunks)).toHaveLength(0);
    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "end" && c.isError === false),
    ).toBe(true);
  });

  test("present_words matches vocabulary case-insensitively and carries the full entry", async () => {
    const { faux, model } = makeFaux();
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("present_words", { terms: ["serendipity", "unknown-word"] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("There you go."),
    ]);
    const { deps } = createInMemoryDeps({ books: BOOKS, vocabulary: VOCABULARY });
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "show my word" }));

    const refs = references(chunks);
    expect(refs).toHaveLength(1);
    const payload = refs[0].reference;
    if (payload.kind !== "words") throw new Error("expected a words payload");
    expect(payload.words).toHaveLength(1);
    expect(payload.words[0].term).toBe("Serendipity");
    expect(payload.words[0].source).toBe("vocabulary");
    expect(payload.words[0].entry).toEqual(SERENDIPITY);
  });

  test("present_words synthesizes a minimal entry when the store has none", async () => {
    const { faux, model } = makeFaux();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("present_words", { terms: ["ephemeral"] })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("There you go."),
    ]);
    const { deps } = createInMemoryDeps({ books: BOOKS, vocabulary: VOCABULARY });
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "show my word" }));

    const payload = references(chunks)[0]?.reference;
    if (payload?.kind !== "words") throw new Error("expected a words payload");
    expect(payload.words[0].entry).toEqual({
      headword: "ephemeral",
      senses: [{ partOfSpeech: "", definition: "lasting a very short time", examples: [] }],
    });
  });

  test("lookup_word emits a lookup-sourced word card and keeps its tool step visible", async () => {
    const { faux, model } = makeFaux();
    let secondRound: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("lookup_word", { term: "serendipity", context: "It was pure serendipity." })],
        { stopReason: "toolUse" },
      ),
      (context) => {
        secondRound = context;
        return fauxAssistantMessage("A lovely word.");
      },
    ]);
    const { deps } = createInMemoryDeps({
      books: BOOKS,
      dictionary: { serendipity: SERENDIPITY },
    });
    const thread = makeThread({ kind: "book", bookId: "b1" as Id }, deps, model);

    const chunks = await collect(thread.sendTurn({ text: "what does serendipity mean?" }));

    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "start" && c.tool === "lookup_word"),
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
