import { describe, expect, test } from "bun:test";
import { normalizeHumanReviewInput, reviewMean } from "./reviews";

describe("human review input", () => {
  test("normalizes a complete review", () => {
    expect(
      normalizeHumanReviewInput({
        targetId: "run:one",
        score: 3,
        verdict: "partial",
        dimensions: { correctness: 2, helpfulness: 4 },
        flags: ["事实错误", "事实错误"],
        notes: "章节关系说反了。",
      }),
    ).toEqual({
      targetId: "run:one",
      score: 3,
      verdict: "partial",
      dimensions: { correctness: 2, helpfulness: 4 },
      flags: ["事实错误"],
      notes: "章节关系说反了。",
    });
  });

  test("rejects scores outside the five-point scale", () => {
    expect(() =>
      normalizeHumanReviewInput({
        targetId: "run:one",
        dimensions: { correctness: 6 },
      }),
    ).toThrow("invalid review dimension correctness");
  });

  test("rejects an invalid overall score", () => {
    expect(() => normalizeHumanReviewInput({ targetId: "run:one", score: 0 })).toThrow(
      "review score must be an integer from 1 to 5",
    );
  });

  test("derives the human verdict from an overall score", () => {
    expect(normalizeHumanReviewInput({ targetId: "run:one", score: 2 }).verdict).toBe("fail");
    expect(normalizeHumanReviewInput({ targetId: "run:one", score: 3 }).verdict).toBe("partial");
    expect(normalizeHumanReviewInput({ targetId: "run:one", score: 5 }).verdict).toBe("pass");
  });

  test("computes the mean over scored dimensions only", () => {
    expect(
      reviewMean({
        targetId: "run:one",
        verdict: "pass",
        dimensions: { correctness: 4, completeness: 5 },
        flags: [],
        notes: "",
        updatedAt: "2026-08-22T00:00:00.000Z",
      }),
    ).toBe(4.5);
  });
});
