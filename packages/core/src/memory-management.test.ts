import { expect, test } from "bun:test";
import { normalizeMemoryMutation } from "./memory-management";
const base = { memoryId: "m", expectedRevision: `mem1:${"a".repeat(64)}` };
test("memory feedback admits only exact bounded semantic operations and copies inputs", () => {
  const input = { ...base, op: "correct" as const, content: "  corrected  " };
  const normalized = normalizeMemoryMutation(input); input.content = "later";
  expect(normalized).toEqual({ ...base, op: "correct", content: "corrected" });
  expect(normalizeMemoryMutation({ ...base, op: "setPinned", pinned: false })).toHaveProperty("pinned", false);
  expect(normalizeMemoryMutation({ ...base, op: "forget" })).toHaveProperty("op", "forget");
  for (const bad of [null, { ...input, content: " " }, { ...input, content: "a".repeat(16001) }, { ...input, importance: 1 },
    { ...base, op: "setPinned", pinned: "false" }, { ...base, op: "forget", reason: "decay" }, { ...input, expectedRevision: "timestamp" }]) {
    expect(() => normalizeMemoryMutation(bad as never)).toThrow();
  }
});
