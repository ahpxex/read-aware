import { describe, expect, test } from "bun:test";
import { parseEvalCliArgs } from "./cli";

describe("eval CLI", () => {
  test("supports the legacy reading provider/model positionals and filters", () => {
    expect(
      parseEvalCliArgs([
        "reading",
        "deepseek",
        "deepseek-v4-flash",
        "--repetitions",
        "3",
        "--scenario",
        "cursor-grounding,explicit-spoiler",
        "--tag",
        "reading",
        "--thinking",
        "high",
        "--no-artifacts",
        "--gate",
      ]),
    ).toMatchObject({
      suiteId: "reading",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      repetitions: 3,
      scenarioIds: ["cursor-grounding", "explicit-spoiler"],
      tags: ["reading"],
      thinkingLevel: "high",
      artifacts: false,
      gate: true,
    });
  });

  test("parses named cross-provider and same-provider candidates", () => {
    const result = parseEvalCliArgs([
      "reading",
      "--provider",
      "deepseek",
      "--candidate",
      "reasoner=deepseek:deepseek-reasoner",
      "--candidate-model",
      "deepseek-chat",
    ]);

    expect(result.candidates).toEqual([
      { id: "reasoner", provider: "deepseek", model: "deepseek-reasoner" },
      { id: "candidate-model-1", provider: "deepseek", model: "deepseek-chat" },
    ]);
  });

  test("rejects unknown suites and malformed candidates", () => {
    expect(() => parseEvalCliArgs(["unknown"])).toThrow("unknown eval suite");
    expect(() => parseEvalCliArgs(["reading", "--candidate", "deepseek"])).toThrow(
      "expected name=provider:model",
    );
  });
});
