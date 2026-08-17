import { describe, expect, test } from "bun:test";
import type { AgentEvalObservation } from "./types";
import { evaluateAgentTrace } from "./assertions";

function observation(
  partial: Partial<AgentEvalObservation> = {},
): AgentEvalObservation {
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
});
