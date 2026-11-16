import { expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import { createInMemoryDeps } from "../testing/fixtures";
import { generateThreadTitle, GENERATED_TITLE_MAX_CHARS, sanitizeThreadTitle, ThreadTitler } from "./thread-titles";

const model = { contextWindow: 128_000, maxTokens: 8192 } as Model<Api>;
/** The text the title call was asked about. */
const promptOf = (context: Context) => {
  const content = context.messages[0]?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};
const turn = (id: string, role: "user" | "assistant", content: string, minute: number) => ({
  id,
  role,
  content,
  createdAt: `2026-11-16T10:${String(minute).padStart(2, "0")}:00.000Z`,
});

test("a title is the first line, without a label, quotes or trailing punctuation", () => {
  expect(sanitizeThreadTitle("近一个月的阅读时长")).toBe("近一个月的阅读时长");
  expect(sanitizeThreadTitle("  “Reading time this month.”  ")).toBe("Reading time this month");
  expect(sanitizeThreadTitle("Title: Pale Fire's commentary")).toBe("Pale Fire's commentary");
  // 《》 mark a book's title and stay.
  expect(sanitizeThreadTitle("标题：《唐诗选注》里的边塞诗。")).toBe("《唐诗选注》里的边塞诗");
  expect(sanitizeThreadTitle("「邓小平时代」")).toBe("邓小平时代");
  expect(sanitizeThreadTitle("\n\n**Sorting the shelf by genre**\nextra line")).toBe("Sorting the shelf by genre");
  expect(sanitizeThreadTitle("Kinbote   and\tShade?")).toBe("Kinbote and Shade");
});

test("output that is not a title is no title", () => {
  expect(sanitizeThreadTitle("")).toBeUndefined();
  expect(sanitizeThreadTitle("  \n \n")).toBeUndefined();
  expect(sanitizeThreadTitle("「」。")).toBeUndefined();
  // A sentence-long answer (a refusal, a reply) is not a title.
  expect(
    sanitizeThreadTitle(
      "I'm sorry, but I can't name this conversation without more context about what the reader asked.",
    ),
  ).toBeUndefined();
  expect(sanitizeThreadTitle("x".repeat(GENERATED_TITLE_MAX_CHARS))).toHaveLength(GENERATED_TITLE_MAX_CHARS);
  expect(sanitizeThreadTitle("x".repeat(GENERATED_TITLE_MAX_CHARS + 1))).toBeUndefined();
});

test("the title is asked for in the reader's language, from a bounded exchange, with a bounded reply", async () => {
  let seen: { system?: string; content?: string; maxTokens?: number } = {};
  const complete: CompleteFn = async (_model, context, options) => {
    seen = { system: context.systemPrompt, content: promptOf(context), maxTokens: options?.maxTokens };
    return fauxAssistantMessage("近一个月的阅读时长");
  };
  const title = await generateThreadTitle({
    complete,
    model,
    userText: "我最近一个月大概读了多少时间？" + "很长".repeat(3000),
    assistantText: "你最近 30 天读了 13 分钟。",
  });
  expect(title).toBe("近一个月的阅读时长");
  expect(seen.system).toContain("Write it in Chinese");
  expect(seen.content?.length).toBeLessThan(4000);
  expect(seen.maxTokens).toBeGreaterThan(0);
});

function titlerFixture(complete: CompleteFn) {
  const { deps, stores } = createInMemoryDeps({
    turns: {
      "global:thread-a": [turn("a1", "user", "我最近读了多少？", 1), turn("a2", "assistant", "13 分钟。", 2)],
      "global:thread-b": [turn("b1", "user", "What is Pale Fire about?", 5)],
      "global:thread-c": [turn("c1", "assistant", "", 3)],
      "book:b1": [turn("k1", "user", "A question about the book", 9)],
    },
  });
  const warnings: unknown[] = [];
  deps.log = {
    warn: (...args) => warnings.push(args),
    error: (...args) => warnings.push(args),
  };
  const titler = new ThreadTitler({ conversations: deps.conversations, complete, model: () => model, log: deps.log });
  return { stores, titler, warnings };
}

test("untitled global threads are titled once, most recent first; book threads and threads without a question are not", async () => {
  const asked: string[] = [];
  const complete: CompleteFn = async (_model, context) => {
    asked.push(promptOf(context));
    return fauxAssistantMessage(asked.length === 1 ? "Pale Fire" : "近期阅读时长");
  };
  const { stores, titler } = titlerFixture(complete);
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 2, halted: false });
  expect(stores.titles.get("global:thread-b")).toBe("Pale Fire");
  expect(stores.titles.get("global:thread-a")).toBe("近期阅读时长");
  expect(stores.titles.has("book:b1")).toBe(false);
  expect(stores.titles.has("global:thread-c")).toBe(false);
  // A titled thread never costs another call.
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: false });
  expect(asked).toHaveLength(2);
});

test("a pass is bounded, and can be narrowed to one thread", async () => {
  let calls = 0;
  const { stores, titler } = titlerFixture(async () => {
    calls += 1;
    return fauxAssistantMessage(`Title ${calls}`);
  });
  expect(await titler.run({ limit: 1, threadKey: "global:thread-a" })).toEqual({ titled: 1, halted: false });
  expect([...stores.titles.keys()]).toEqual(["global:thread-a"]);
  expect(await titler.run({ limit: 1 })).toEqual({ titled: 1, halted: false });
  expect(calls).toBe(2);
});

test("an account failure stops the pass and leaves every thread for later; any other failure skips just that thread", async () => {
  let mode: "auth" | "network" | "ok" = "auth";
  let calls = 0;
  const { stores, titler, warnings } = titlerFixture(async () => {
    calls += 1;
    if (mode === "auth") throw new AppError("ai/auth", "fixture");
    if (mode === "network") throw new AppError("ai/network", "fixture");
    return fauxAssistantMessage("A title");
  });
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: true });
  expect(calls).toBe(1);
  // The account recovers, the network fails once: that thread waits for the next session.
  mode = "network";
  expect(await titler.run({ limit: 1 })).toEqual({ titled: 0, halted: false });
  mode = "ok";
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 1, halted: false });
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: false });
  expect(stores.titles.size).toBe(1);
  expect(calls).toBe(3);
  expect(warnings.length).toBeGreaterThan(0);
});

test("a provider failure reported as a message is classified, and an auth failure stops the pass", async () => {
  let calls = 0;
  const { titler } = titlerFixture(async () => {
    calls += 1;
    return fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized: invalid api key" });
  });
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: true });
  expect(calls).toBe(1);
});

test("a reply cut off at the output cap is not a title", async () => {
  const complete: CompleteFn = async () => fauxAssistantMessage("近一个月阅读", { stopReason: "length" });
  expect(await generateThreadTitle({ complete, model, userText: "我最近读了多少？" })).toBeUndefined();
  const { titler, stores } = titlerFixture(complete);
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: false });
  expect(stores.titles.size).toBe(0);
});

test("output that is not a title skips that thread for the session, not the others", async () => {
  let calls = 0;
  const { stores, titler } = titlerFixture(async (_model, context) => {
    calls += 1;
    return fauxAssistantMessage(promptOf(context).includes("Pale Fire") ? "" : "近期阅读时长");
  });
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 1, halted: false });
  expect(await titler.run({ limit: 10 })).toEqual({ titled: 0, halted: false });
  expect(calls).toBe(2);
  expect(stores.titles.has("global:thread-b")).toBe(false);
});
