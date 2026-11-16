import { expect, test } from "bun:test";
import { formatRunCauses, formatRunLine, runCause } from "./report";
import type { EvalRunRecord } from "./types";

const base = {
  id: "r",
  suiteId: "s",
  scenarioId: "scenario",
  variantId: "baseline",
  repetition: 1,
  executionIndex: 0,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  input: {},
  telemetry: { wallTimeMs: 1000 },
} as unknown as EvalRunRecord;
const failed = (checks: string[], output: object = {}): EvalRunRecord =>
  ({
    ...base,
    status: "failed",
    output,
    assessment: {
      score: 0.5,
      passed: false,
      checks: checks.map((id) => ({ id, category: "quality", passed: false, message: id })),
    },
  }) as unknown as EvalRunRecord;
const errored = (stage: string, code?: string): EvalRunRecord =>
  ({
    ...base,
    status: "error",
    error: { stage, name: "Error", message: "boom", ...(code ? { code } : {}) },
  }) as unknown as EvalRunRecord;

test("a run that did not pass says why, in the terms that decide what to do about it", () => {
  // The environment, not the agent.
  expect(runCause(errored("timeout"))).toBe("timeout");
  expect(runCause(errored("execution", "ai/provider"))).toBe("provider");
  expect(runCause(errored("setup"))).toBe("setup");
  expect(runCause(errored("execution"))).toBe("harness");
  // The runtime replaced the model's answer: a missing keyword is then a symptom, not the cause.
  expect(runCause(failed(["answer.contains.0"], { interventions: [{ turn: 1, kind: "answer-withheld" }] }))).toBe(
    "answer-withheld",
  );
  expect(runCause(failed(["answer.contains.0"], { interventions: [{ turn: 1, kind: "answer-rewritten" }] }))).toBe(
    "answer-rewritten",
  );
  // What is left is the model's own tool use or answer.
  expect(runCause(failed(["tool.no-errors", "tool.max-calls"]))).toBe("tool-error");
  expect(runCause(failed(["tool.no-errors", "answer.contains.0"]))).toBe("answer");
  expect(runCause({ ...base, status: "passed" } as unknown as EvalRunRecord)).toBeUndefined();
  expect(
    formatRunLine(failed(["answer.contains.0"], { interventions: [{ turn: 1, kind: "answer-withheld" }] })),
  ).toEndWith("cause=answer-withheld");
  expect(
    formatRunCauses([
      failed(["a"]),
      failed(["b"]),
      errored("timeout"),
      { ...base, status: "passed" } as unknown as EvalRunRecord,
    ]),
  ).toBe("2 the answer itself, 1 timed out");
});
