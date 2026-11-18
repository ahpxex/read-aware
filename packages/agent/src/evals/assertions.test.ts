import { describe, expect, test } from "bun:test";
import type { AgentEvalObservation } from "./types";
import { evaluateAgentTrace } from "./assertions";

function observation(partial: Partial<AgentEvalObservation> = {}): AgentEvalObservation {
  return {
    turns: [],
    answer: "",
    thinking: "",
    tools: [],
    interactions: [],
    modelRequests: [],
    telemetry: { wallTimeMs: 1, rounds: 0 },
    ...partial,
  };
}

describe("agent eval assertions", () => {
  test("reports answer leaks and the retrieval path as separate checks", () => {
    const result = evaluateAgentTrace(
      observation({
        answer: "The later reveal names Rowan.",
        tools: [{ turn: 1, id: "call-1", name: "read_chapter" }],
      }),
      {
        answer: { mustNotContain: ["Rowan"] },
        tools: { forbidden: ["read_chapter", "search_book_text"] },
      },
    );

    expect(result.passed).toBe(false);
    // 全局 no-emoji + script-consistency 通过 + 一条通过的 forbidden-tool 检查 = 5 中过 3
    expect(result.score).toBe(0.6);
    expect(result.checks.filter((entry) => !entry.passed).map((entry) => entry.message)).toEqual([
      'answer contained forbidden phrase "Rowan"',
      "forbidden tool read_chapter ran",
    ]);
  });

  test("accepts a grounded answer and checks tool health and interaction policy", () => {
    const result = evaluateAgentTrace(
      observation({
        answer: "The confession identifies Rowan.",
        tools: [
          {
            turn: 1,
            id: "call-1",
            name: "search_book_text",
            isError: false,
          },
        ],
        interactions: [
          {
            turn: 1,
            phase: "request",
            kind: "question",
            id: "question-1",
            value: {},
          },
        ],
        telemetry: { wallTimeMs: 1, rounds: 2 },
      }),
      {
        answer: { mustContain: ["Rowan"] },
        tools: {
          requiredAny: ["read_chapter", "search_book_text"],
          noErrors: true,
          maxCalls: 1,
        },
        interactions: { requiredKinds: ["question"], forbiddenKinds: ["permission"] },
        maxRounds: 2,
      },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  describe("reply script", () => {
    const chinese = "你的书架上现在有三本书：《群山回响》《The Glass Orchard》和《长夜将尽》，其中两本还在读。";
    const english =
      "You have three books on your shelf: 群山回响, The Glass Orchard and 长夜将尽. Two of them are still in progress.";
    const scriptCheck = (answer: string, text: string, script?: "cjk" | "latin") =>
      evaluateAgentTrace(
        observation({ answer, turns: [{ turn: 1, input: { text }, answer, thinking: "", chunks: [] }] }),
        { answer: { script } },
      ).checks.find((entry) => entry.id === "answer.script-consistency")!;

    test("takes a Latin-script question to expect a Latin-script reply unless the scenario says otherwise", () => {
      expect(scriptCheck(english, "Which books are on my shelf?").passed).toBe(true);
      expect(scriptCheck(chinese, "Which books are on my shelf?").passed).toBe(false);
      // The reader asked for Chinese in English: the declared script decides, in both directions.
      expect(scriptCheck(chinese, "Please answer in Chinese: which books are on my shelf?", "cjk").passed).toBe(true);
      expect(scriptCheck(english, "Please answer in Chinese: which books are on my shelf?", "cjk").passed).toBe(false);
    });

    test("holds a Chinese question to a declared script and leaves an undeclared one unchecked", () => {
      expect(scriptCheck(english, "请用英文回答：我书架上有哪些书？", "latin").passed).toBe(true);
      expect(scriptCheck(chinese, "请用英文回答：我书架上有哪些书？", "latin").passed).toBe(false);
      expect(scriptCheck(english, "我书架上有哪些书？").passed).toBe(true);
    });

    test("reads a short Chinese reply that quotes a long English title as Chinese", () => {
      // 28% of its characters are CJK: fewer than the letters of the title it has to quote.
      const reply = "是的，已经读完了。书架上《The Glass Orchard》（P. Vine）的状态是“已读完”（finished）。";
      expect(scriptCheck(reply, "我书架上的 The Glass Orchard 读完了吗？", "cjk").passed).toBe(true);
      expect(scriptCheck(reply, "我书架上的 The Glass Orchard 读完了吗？", "latin").passed).toBe(false);
    });
  });
});
