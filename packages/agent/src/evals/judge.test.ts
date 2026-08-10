import { describe, expect, test } from "bun:test";
import { AgentEvalJudge, digestObservation, withJudge } from "./judge";
import { defineAgentEvalScenario } from "./agent-harness";
import type { AgentEvalObservation } from "./types";

const RUBRIC = ["States time in human units", "No raw counters"];

function observation(answer: string): unknown {
  return {
    answer,
    thinking: "",
    turns: [{ turn: 1, input: { text: "How long did I read?" }, answer, thinking: "", chunks: [] }],
    tools: [{ turn: 1, id: "t1", name: "get_reading_stats", args: { allBooks: true } }],
    interactions: [],
    modelRequests: [],
    telemetry: { wallTimeMs: 1 },
  };
}

function verdictJson(scores: number[]): string {
  return JSON.stringify({
    criteria: scores.map((score, index) => ({
      criterion: RUBRIC[index],
      score,
      rationale: `criterion ${index}`,
    })),
  });
}

describe("digestObservation", () => {
  test("extracts turns, answer, and truncated tool args from loose JSON", () => {
    const digest = digestObservation(observation("About 1h 30m."));
    expect(digest.userTurns).toEqual(["How long did I read?"]);
    expect(digest.answer).toBe("About 1h 30m.");
    expect(digest.tools).toEqual([
      { name: "get_reading_stats", args: '{"allBooks":true}' },
    ]);
  });

  test("tolerates malformed observations", () => {
    expect(digestObservation(null)).toEqual({ userTurns: [], answer: "", tools: [] });
    expect(digestObservation({ answer: 42, turns: "x", tools: [{}] })).toEqual({
      userTurns: [],
      answer: "",
      tools: [],
    });
  });
});

describe("AgentEvalJudge", () => {
  test("maps verdicts to quality checks with the pass threshold", async () => {
    const prompts: string[] = [];
    const judge = new AgentEvalJudge({
      complete: async (prompt) => {
        prompts.push(prompt);
        return verdictJson([0.9, 0.4]);
      },
    });
    const assessment = await judge.assess({
      description: "Humane stats",
      rubric: RUBRIC,
      observation: observation("About 1h 30m."),
    });
    expect(assessment.passed).toBe(false);
    expect(assessment.score).toBe(0.5);
    expect(assessment.checks).toEqual([
      expect.objectContaining({
        id: "quality.judge.0",
        category: "quality",
        passed: true,
        expected: RUBRIC[0],
        actual: 0.9,
      }),
      expect.objectContaining({ id: "quality.judge.1", passed: false, actual: 0.4 }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Humane stats");
    expect(prompts[0]).toContain("get_reading_stats");
  });

  test("retries once on malformed output, then fails loudly", async () => {
    let calls = 0;
    const flaky = new AgentEvalJudge({
      complete: async () => {
        calls += 1;
        return calls === 1 ? "not json" : `\`\`\`json\n${verdictJson([1, 1])}\n\`\`\``;
      },
    });
    const assessment = await flaky.assess({
      description: "d",
      rubric: RUBRIC,
      observation: observation("ok"),
    });
    expect(assessment.passed).toBe(true);
    expect(calls).toBe(2);

    const broken = new AgentEvalJudge({ complete: async () => "still not json" });
    await expect(
      broken.assess({ description: "d", rubric: RUBRIC, observation: observation("ok") }),
    ).rejects.toThrow("parseable verdict");
  });

  test("rejects verdicts whose criteria count mismatches the rubric", async () => {
    const judge = new AgentEvalJudge({ complete: async () => verdictJson([1]) });
    await expect(
      judge.assess({ description: "d", rubric: RUBRIC, observation: observation("ok") }),
    ).rejects.toThrow("parseable verdict");
  });
});

describe("withJudge", () => {
  const base = defineAgentEvalScenario({
    id: "judge-wrap",
    description: "wrapped",
    scope: { kind: "global", threadId: "judge-thread" },
    turns: [{ text: "hi" }],
    expectation: { answer: { mustContain: ["about"] } },
    rubric: RUBRIC,
  });

  test("combines deterministic checks with scenario + global quality criteria", async () => {
    const prompts: string[] = [];
    const judge = new AgentEvalJudge({
      complete: async (prompt) => {
        prompts.push(prompt);
        // 自定义 2 条 + 全局 2 条
        return JSON.stringify({
          criteria: [1, 1, 1, 1].map((score, index) => ({
            criterion: `c${index}`,
            score,
            rationale: "ok",
          })),
        });
      },
    });
    const wrapped = withJudge(base, judge);
    const assessment = await wrapped.evaluate(
      observation("It took about 1h 30m.") as unknown as AgentEvalObservation,
    );
    const ids = assessment.checks.map((check) => check.id);
    expect(ids).toContain("answer.contains.0");
    expect(ids).toContain("quality.judge.0");
    expect(ids).toContain("quality.judge.3");
    expect(prompts[0]).toContain("thoughtful reading companion");
    expect(assessment.passed).toBe(true);
  });

  test("rubric-less scenarios still get the global quality rubric", async () => {
    const plain = defineAgentEvalScenario({
      id: "no-rubric",
      description: "plain",
      scope: { kind: "global", threadId: "judge-thread" },
      turns: [{ text: "hi" }],
    });
    const judge = new AgentEvalJudge({
      complete: async () =>
        JSON.stringify({
          criteria: [
            { criterion: "direct", score: 1, rationale: "ok" },
            { criterion: "prose", score: 0.4, rationale: "meandering" },
          ],
        }),
    });
    const wrapped = withJudge(plain, judge);
    expect(wrapped).not.toBe(plain);
    const assessment = await wrapped.evaluate(
      observation("hello there") as unknown as AgentEvalObservation,
    );
    const quality = assessment.checks.filter((check) => check.id.startsWith("quality.judge"));
    expect(quality).toHaveLength(2);
    expect(quality[1]?.passed).toBe(false);
  });
});
