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
import type { AnnotationRecord, BookOverview, RuntimeDeps } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
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
  const { deps, stores } = createInMemoryDeps({
    books: BOOKS,
    annotations: ANNOTATIONS,
    profile: "Prefers first-principles explanations.",
  });
  return { deps, turns: stores.turns };
}

/** 提炼调用的空实现：永远返回"无候选"。 */
const noopComplete = async () =>
  fauxAssistantMessage('{"new": [], "reinforced": []}');

function makeThread(deps: RuntimeDeps, model: Model<Api>, maxWindowTurns?: number) {
  return new AgentThread({
    scope: { kind: "book", bookId: "b1" as Id },
    deps,
    resolveModel: () => model,
    getApiKey: () => "test-key",
    completeFn: noopComplete,
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

  test("grounds the reading position in the system prompt via the chapter href", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps } = createInMemoryDeps({
      books: BOOKS,
      chapters: {
        b1: [
          { title: "Intro", text: "x".repeat(50), hrefs: ["intro.xhtml"] },
          { title: "Chapter 2", text: "y".repeat(50), hrefs: ["text/ch2.xhtml"] },
        ],
      },
    });
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "这一章讲什么？", chapter: "text/ch2.xhtml#p3" }));

    expect(captured?.systemPrompt).toContain('chapter #1 ("Chapter 2")');
  });

  test("freezes the system prompt within a chapter session, rebuilds on crossing", async () => {
    const { faux, model } = makeFaux();
    const prompts: (string | undefined)[] = [];
    faux.setResponses([
      (context) => { prompts.push(context.systemPrompt); return fauxAssistantMessage("a1"); },
      (context) => { prompts.push(context.systemPrompt); return fauxAssistantMessage("a2"); },
      (context) => { prompts.push(context.systemPrompt); return fauxAssistantMessage("a3"); },
    ]);
    const { deps, stores } = createInMemoryDeps({
      books: BOOKS,
      profile: "old profile",
      chapters: {
        b1: [
          { title: "Chapter 1", text: "x".repeat(50), hrefs: ["ch1.xhtml"] },
          { title: "Chapter 2", text: "y".repeat(50), hrefs: ["ch2.xhtml"] },
        ],
      },
    });
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    // 会话中途画像变了 —— 冻结的 prompt 不该看到它
    stores.profile.summary = "NEW PROFILE";
    await collect(thread.sendTurn({ text: "q2", chapter: "ch1.xhtml" }));
    expect(prompts[1]).toBe(prompts[0]!);
    // 换章 → 会话重置 → prompt 重建：新画像与新章节一起生效
    await collect(thread.sendTurn({ text: "q3", chapter: "ch2.xhtml" }));
    expect(prompts[2]).toContain("NEW PROFILE");
    expect(prompts[2]).toContain('chapter #1 ("Chapter 2")');
  });

  test("chapter session: turns in the same chapter share the accumulated context", async () => {
    const { faux, model } = makeFaux();
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => { contexts.push(context); return fauxAssistantMessage("a1"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a2"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a3"); },
    ]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    await collect(thread.sendTurn({ text: "q2", chapter: "ch1.xhtml" }));
    await collect(thread.sendTurn({ text: "q3", chapter: "ch1.xhtml" }));

    // 会话内连续：第三轮带完整累积（u1,a1,u2,a2,u3），而不是一轮尾巴的 3 条
    expect(contexts[2]?.messages).toHaveLength(5);
  });

  test("chapter session: first message from another chapter resets to the one-turn tail", async () => {
    const { faux, model } = makeFaux();
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => { contexts.push(context); return fauxAssistantMessage("a1"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a2"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a3"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a4"); },
    ]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    await collect(thread.sendTurn({ text: "q2", chapter: "ch1.xhtml" }));
    // 换章发新消息 → 旧 state 扔掉，重置为持久记录的一轮尾巴（q2,a2）+ 本轮
    await collect(thread.sendTurn({ text: "q3", chapter: "ch2.xhtml" }));
    expect(contexts[2]?.messages).toHaveLength(3);
    // 新章节里继续 → 又开始累积（q2,a2,u3,a3,u4）
    await collect(thread.sendTurn({ text: "q4", chapter: "ch2.xhtml" }));
    expect(contexts[3]?.messages).toHaveLength(5);
  });

  test("chapter session: a turn without chapter info stays in the current session", async () => {
    const { faux, model } = makeFaux();
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => { contexts.push(context); return fauxAssistantMessage("a1"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a2"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a3"); },
    ]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    await collect(thread.sendTurn({ text: "q2", chapter: "ch1.xhtml" }));
    // 章节未知 ≠ 换章：会话保持连续
    await collect(thread.sendTurn({ text: "q3" }));
    expect(contexts[2]?.messages).toHaveLength(5);
  });

  test("chapter session: the selection attachment's chapter is the boundary signal", async () => {
    const { faux, model } = makeFaux();
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => { contexts.push(context); return fauxAssistantMessage("a1"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a2"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a3"); },
    ]);
    const { deps } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    await collect(thread.sendTurn({ text: "q2", chapter: "ch1.xhtml" }));
    // 选区来自 ch2（attachment 的 chapter 优先于阅读位置）→ 视为换章
    await collect(
      thread.sendTurn({
        text: "q3",
        chapter: "ch1.xhtml",
        attachments: [{ text: "quoted", chapter: "ch2.xhtml" }],
      }),
    );
    expect(contexts[2]?.messages).toHaveLength(3);
  });

  test("a failed turn does not pollute the next turn's context (global thread)", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" }),
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps } = makeDeps();
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "t1" },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: noopComplete,
    });

    await expect(collect(thread.sendTurn({ text: "q1" }))).rejects.toThrow("boom");
    await collect(thread.sendTurn({ text: "q2" }));

    // 失败轮既没持久化也不留在内存态：重建后上下文只有本轮的用户消息
    expect(captured?.messages).toHaveLength(1);
  });

  test("reset discards the in-memory session and rebuilds from the persisted transcript", async () => {
    const { faux, model } = makeFaux();
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => { contexts.push(context); return fauxAssistantMessage("a1"); },
      (context) => { contexts.push(context); return fauxAssistantMessage("a2"); },
    ]);
    const { deps, turns } = makeDeps();
    const thread = makeThread(deps, model);

    await collect(thread.sendTurn({ text: "q1", chapter: "ch1.xhtml" }));
    // UI 的 retry：先截断持久转录（丢掉 q1/a1），再带 reset 重发
    turns.set("book:b1", []);
    await collect(thread.sendTurn({ text: "q1-retry", chapter: "ch1.xhtml", reset: true }));

    // 无 reset 时章节会话延续，上下文会是 [q1, a1, q1-retry]；
    // reset 后从截断的持久层重建 —— 只剩本轮
    expect(contexts[1]?.messages).toHaveLength(1);
  });

  test("a pre-persisted current user message is not double-fed (global hydration)", async () => {
    const { faux, model } = makeFaux();
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { deps, turns } = makeDeps();
    // UI 在流开始前 persist 了 [历史..., 本轮 q]；全局线程首轮水化会读到它
    turns.set("global:t1", [
      { role: "user", content: "old q", createdAt: "2026-06-01T00:00:00Z" },
      { role: "assistant", content: "old a", createdAt: "2026-06-01T00:00:05Z" },
      { role: "user", content: "new q", createdAt: "2026-06-02T00:00:00Z" },
    ]);
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "t1" },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: noopComplete,
    });

    await collect(thread.sendTurn({ text: "new q" }));

    // [old q, old a, new q]，而不是 [old q, old a, new q, new q]
    expect(captured?.messages).toHaveLength(3);
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
