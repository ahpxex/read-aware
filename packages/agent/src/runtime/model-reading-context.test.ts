import { expect, test } from "bun:test";
import { modelReadingPrompt, validateModelReadingContext } from "./model-reading-context";

test("host assembles only permitted fragments across all four privacy combinations", () => {
  for (const selection of [false, true]) for (const surrounding of [false, true]) {
    const prompt = modelReadingPrompt("Typed question", { selection: "SELECTION_947", surrounding: "PASSAGE_628" }, { selection, surrounding });
    expect(prompt).toContain("Typed question");
    expect(prompt.includes("SELECTION_947")).toBe(selection);
    expect(prompt.includes("PASSAGE_628")).toBe(selection && surrounding);
  }
});

test("required fragments reject instead of silently changing the request", () => {
  for (const key of ["selection", "surrounding"] as const) {
    expect(() => modelReadingPrompt("Question", { [key]: "text", required: [key] }, { selection: false, surrounding: true }))
      .toThrow(expect.objectContaining({ code: "ai/context-withheld" }));
  }
});

test("Worker input is validated and copied, including required fragment declarations", () => {
  for (const value of [null, [], "text", { extra: "text" }, { selection: 3 }, { required: "selection" },
    { required: ["other"] }, { required: ["selection"] }, { selection: " ", required: ["selection"] }]) {
    expect(() => validateModelReadingContext(value)).toThrow(expect.objectContaining({ code: "ai/invalid-reading-context" }));
  }
  const input = { selection: "text", required: ["selection", "selection"] };
  const copied = validateModelReadingContext(input);
  input.selection = "changed"; input.required.length = 0;
  expect(copied).toEqual({ selection: "text", surrounding: undefined, required: ["selection"] });
});
