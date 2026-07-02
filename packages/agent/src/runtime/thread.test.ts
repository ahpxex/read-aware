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
import type { AnnotationRecord, BookOverview, RuntimeDeps, TurnRecord } from "../ports";
import { AgentThread } from "./thread";

const BOOKS: BookOverview[] = [
  { id: "b1" as Id, title: "Debt: The First 5000 Years", author: "David Graeber", progressFraction: 0.42 },
  { id: "b2" as Id, title: "Sapiens", author: "Yuval Noah Harari", progressFraction: 0.9 },
];

const ANNOTATIONS: AnnotationRecord[] = [
  { id: "a1", bookId: "b1" as Id, kind: "highlight", text: "barter myth", createdAt: "2026-06-01T00:00:00Z" },
  { id: "a2", bookId: "b1" as Id, kind: "note", text: "credit precedes coin", content: "check sources", createdAt: "2026-06-02T00:00:00Z" },
];

function makeDeps() {
  const turns = new Map<string, TurnRecord[]>();
  const deps: RuntimeDeps = {
    library: {
      listBooks: async () => BOOKS,
      getBook: async (id) => BOOKS.find((book) => book.id === id),
    },
    annotations: {
      listAnnotations: async (filter) =>
        ANNOTATIONS.filter((a) => !filter?.bookId || a.bookId === filter.bookId),
    },
    conversations: {
      load: async (key) => turns.get(key) ?? [],
      append: async (key, turn) => {
        const list = turns.get(key) ?? [];
        list.push(turn);
        turns.set(key, list);
      },
    },
    profile: {
      getProfileSummary: async () => "Prefers first-principles explanations.",
    },
  };
  return { deps, turns };
}

function makeThread(deps: RuntimeDeps, model: Model<Api>, maxWindowTurns?: number) {
  return new AgentThread({
    scope: { kind: "book", bookId: "b1" as Id },
    deps,
    resolveModel: () => model,
    getApiKey: () => "test-key",
    maxWindowTurns,
  });
}

async function collect(iterable: AsyncIterable<ThreadChunk>): Promise<ThreadChunk[]> {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

describe("AgentThread", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): { faux: FauxProviderRegistration; model: Model<Api> } {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return { faux, model: faux.getModel() as Model<Api> };
  }

  afterEach(() => {
    faux?.unregister();
  });

  test("streams text and tool steps, persists both turns", async () => {
    const { faux, model } = makeFaux();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("get_annotations", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("You highlighted two passages."),
    ]);
    const { deps, turns } = makeDeps();
    const thread = makeThread(deps, model);

    const chunks = await collect(thread.sendTurn({ text: "我划了什么重点？" }));

    const text = chunks.filter((c) => c.type === "text").map((c) => c.text).join("");
    expect(text).toBe("You highlighted two passages.");
    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "start" && c.tool === "get_annotations"),
    ).toBe(true);
    expect(
      chunks.some((c) => c.type === "tool-step" && c.phase === "end" && c.isError === false),
    ).toBe(true);

    const persisted = turns.get("book:b1");
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0].role).toBe("user");
    expect(persisted?.[1].content).toBe("You highlighted two passages.");
  });

  test("hydrates persisted history and assembles the system prompt", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps, turns } = makeDeps();
    turns.set("book:b1", [
      { role: "user", content: "q1", createdAt: "2026-06-01T00:00:00Z" },
      { role: "assistant", content: "a1", createdAt: "2026-06-01T00:00:05Z" },
    ]);
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q2" }));

    expect(captured?.messages).toHaveLength(3);
    expect(captured?.systemPrompt).toContain("Debt: The First 5000 Years");
    expect(captured?.systemPrompt).toContain("first-principles");
    expect(captured?.systemPrompt).toContain("42%");
  });

  test("windows the context to the last N user turns", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps, turns } = makeDeps();
    turns.set("book:b1", [
      { role: "user", content: "q1", createdAt: "2026-06-01T00:00:00Z" },
      { role: "assistant", content: "a1", createdAt: "2026-06-01T00:00:05Z" },
      { role: "user", content: "q2", createdAt: "2026-06-01T00:01:00Z" },
      { role: "assistant", content: "a2", createdAt: "2026-06-01T00:01:05Z" },
    ]);
    const thread = makeThread(deps, model, 1);

    await collect(thread.sendTurn({ text: "q3" }));

    expect(captured?.messages).toHaveLength(1);
  });

  test("selection attachments are quoted into the user message", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(
      thread.sendTurn({
        text: "这段怎么理解？",
        attachments: [{ text: "money is credit", chapter: "Chapter 2" }],
      }),
    );

    // pi 在发给 provider 前会把 user content 规范化成 blocks
    const userMessage = captured?.messages[0] as {
      content: string | { type: string; text?: string }[];
    };
    const contentText =
      typeof userMessage.content === "string"
        ? userMessage.content
        : userMessage.content.map((block) => block.text ?? "").join("");
    expect(contentText).toContain("> money is credit");
    expect(contentText).toContain("Chapter 2");
    expect(contentText).toContain("这段怎么理解？");
  });

  test("rejects a second turn while one is streaming", async () => {
    const { faux, model } = makeFaux();
    faux.setResponses([fauxAssistantMessage("first answer")]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    const first = thread.sendTurn({ text: "one" });
    await first.next(); // 进入流式（拿到 status chunk）
    const second = thread.sendTurn({ text: "two" });
    await expect(second.next()).rejects.toThrow("already streaming");
    await collect(first as unknown as AsyncIterable<ThreadChunk>);
  });
});
