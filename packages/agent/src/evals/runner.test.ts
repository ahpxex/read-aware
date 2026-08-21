import { describe, expect, test } from "bun:test";
import { assessmentFromChecks } from "./assertions";
import { runEvalSuite } from "./runner";
import { EvalStageError, type EvalScenario, type EvalVariant } from "./types";

type Observation = { value: number };
type Scenario = EvalScenario<Observation>;

function scenario(evaluate: Scenario["evaluate"]): Scenario {
  return {
    id: "case",
    description: "test case",
    tags: ["test"],
    input: { prompt: "test" },
    evaluate,
  };
}

function variant(
  id: string,
  value: number,
  order?: string[],
): EvalVariant<Scenario, Observation> {
  return {
    id,
    metadata: { model: id },
    run: async (_scenario, context) => {
      order?.push(`${context.repetition}:${id}`);
      return {
        observation: { value },
        telemetry: {
          wallTimeMs: 10,
          modelTimeMs: 8,
          rounds: 1,
          tokens: { input: value, output: 1, cacheRead: 0, cacheWrite: 0, total: value + 1 },
        },
      };
    },
  };
}

describe("eval runner", () => {
  test("repeats, balances variant order, and computes paired comparisons", async () => {
    const order: string[] = [];
    const result = await runEvalSuite(
      { id: "suite", code: "S00", description: "suite", scenarios: [scenario((output) => assessmentFromChecks([
        {
          id: "value",
          category: "quality",
          passed: output.value > 0,
          message: "value is positive",
        },
      ]))] },
      [variant("baseline", 0, order), variant("candidate", 2, order)],
      { repetitions: 2 },
    );

    expect(order).toEqual([
      "1:baseline",
      "1:candidate",
      "2:candidate",
      "2:baseline",
    ]);
    expect(result.summary).toMatchObject({ runs: 4, passed: 2, failed: 2, errors: 0 });
    expect(result.summary.comparisons).toEqual([
      expect.objectContaining({
        baselineVariantId: "baseline",
        candidateVariantId: "candidate",
        pairedRuns: 2,
        passRateDelta: 1,
        meanScoreDelta: 1,
        telemetryDelta: expect.objectContaining({
          meanTokens: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
        }),
      }),
    ]);
  });

  test("separates setup, scoring, and timeout errors", async () => {
    const setupVariant: EvalVariant<Scenario, Observation> = {
      id: "setup",
      metadata: {},
      run: async () => {
        throw new EvalStageError("setup", "fixture failed");
      },
    };
    const scoringVariant = variant("scoring", 1);
    const timeoutVariant: EvalVariant<Scenario, Observation> = {
      id: "timeout",
      metadata: {},
      run: (_scenario, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        }),
    };
    const result = await runEvalSuite(
      {
        id: "errors",
        code: "S00",
        description: "errors",
        scenarios: [
          scenario(() => {
            throw new Error("judge failed");
          }),
        ],
      },
      [setupVariant, scoringVariant, timeoutVariant],
      { timeoutMs: 5 },
    );

    expect(result.records.map((record) => record.error?.stage)).toEqual([
      "setup",
      "scoring",
      "timeout",
    ]);
    expect(result.summary.errors).toBe(3);
  });

  test("validates suite and variant identity before executing", async () => {
    const duplicate = variant("same", 1);
    await expect(
      runEvalSuite(
        { id: "suite", code: "S00", description: "suite", scenarios: [scenario(() => assessmentFromChecks([]))] },
        [duplicate, duplicate],
      ),
    ).rejects.toThrow("variants contains duplicate id");
  });
});

describe("eval runner concurrency", () => {
  test("parallel units still produce every paired record", async () => {
    const passing = assessmentFromChecks([
      { id: "ok", category: "answer", passed: true, message: "ok" },
    ]);
    const scenarios = ["s1", "s2", "s3", "s4"].map((id) => ({
      ...scenario(async () => passing),
      id,
    }));
    const result = await runEvalSuite(
      { id: "suite", code: "S00", description: "d", scenarios },
      [variant("baseline", 1), variant("candidate", 2)],
      { repetitions: 3, concurrency: 3 },
    );

    expect(result.records).toHaveLength(24);
    for (const id of ["s1", "s2", "s3", "s4"]) {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        const pair = result.records.filter(
          (record) => record.scenarioId === id && record.repetition === repetition,
        );
        expect(pair.map((record) => record.variantId).sort()).toEqual([
          "baseline",
          "candidate",
        ]);
      }
    }
    const comparison = result.summary.comparisons[0];
    expect(comparison?.pairedRuns).toBe(12);
  });
});
