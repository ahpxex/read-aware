import { describe, expect, test } from "bun:test";
import { assessmentFromChecks } from "./assertions";
import { rescoreEvalRecords } from "./rescore";
import type { EvalRunRecord, EvalScenario } from "./types";

type Observation = { answer: string };

function record(input: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "suite:case:baseline:1",
    suiteId: "suite",
    scenarioId: "case",
    variantId: "baseline",
    repetition: 1,
    executionIndex: 1,
    status: "failed",
    startedAt: "2026-08-02T00:00:00.000Z",
    finishedAt: "2026-08-02T00:00:01.000Z",
    input: {},
    output: { answer: "correct" },
    telemetry: { wallTimeMs: 1 },
    ...input,
  };
}

describe("eval artifact rescoring", () => {
  test("re-evaluates stored outputs without rerunning the model", async () => {
    const scenario: EvalScenario<Observation> = {
      id: "case",
      description: "case",
      input: {},
      evaluate: (observation) =>
        assessmentFromChecks([
          {
            id: "answer",
            category: "answer",
            passed: observation.answer === "correct",
            message: "answer is correct",
          },
        ]),
    };
    const result = await rescoreEvalRecords(
      { id: "suite", displayName: "Suite", code: "S00", description: "suite", scenarios: [scenario] },
      ["baseline"],
      [record({ error: { stage: "scoring", name: "Error", message: "old scorer" } })],
    );

    expect(result.records[0]).toMatchObject({ status: "passed", assessment: { score: 1 } });
    expect(result.records[0]?.error).toBeUndefined();
    expect(result.summary).toMatchObject({ passed: 1, failed: 0, errors: 0 });
  });

  test("preserves execution errors that have no model output", async () => {
    const scenario: EvalScenario<Observation> = {
      id: "case",
      description: "case",
      input: {},
      evaluate: () => assessmentFromChecks([]),
    };
    const failed = record({
      status: "error",
      output: undefined,
      error: { stage: "execution", name: "Error", message: "provider unavailable" },
    });
    const result = await rescoreEvalRecords(
      { id: "suite", displayName: "Suite", code: "S00", description: "suite", scenarios: [scenario] },
      ["baseline"],
      [failed],
    );

    expect(result.records[0]).toEqual(failed);
    expect(result.summary.errors).toBe(1);
  });
});
