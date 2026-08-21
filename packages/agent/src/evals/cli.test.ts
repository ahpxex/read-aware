import { describe, expect, test } from "bun:test";
import { parseEvalCliArgs, resolveEvalTargets } from "./cli";

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

  test("accepts group selectors and expands them per suite", () => {
    const options = parseEvalCliArgs(["behavior", "--tag", "honesty"]);
    expect(options.suiteId).toBe("behavior");
    const targets = resolveEvalTargets(options);
    // 只剩带 honesty 标签的套件；每套件内只保留匹配场景
    for (const target of targets) {
      expect(target.scenarios.length).toBeGreaterThan(0);
      expect(
        target.scenarios.every((scenario) =>
          scenario.tags?.includes("honesty"),
        ),
      ).toBe(true);
    }
    expect(targets.some((target) => target.suiteId === "grounding")).toBe(true);
    expect(targets.some((target) => target.suiteId === "tools")).toBe(true);
  });

  test("group scenario filters are validated against the union of member suites", () => {
    const options = parseEvalCliArgs(["realbook", "--scenario", "no-such-scenario"]);
    expect(() => resolveEvalTargets(options)).toThrow("unknown scenarios: no-such-scenario");
  });
});
