import { expect, test } from "bun:test";
import { readingContextCall, permittedReadingCursor, permittedTurnRecords } from "./reading-context-policy";
import { contextPolicyState } from "../testing/reading-context-policy";

test("withholding either input removes the whole potentially overlapping viewport, not its location", () => {
  const cursor = { chapter: "one", anchor: "cfi", visibleText: "prefix SELECTED suffix" };
  for (const permissions of [{ selection: false, surrounding: true }, { selection: true, surrounding: false }, { selection: false, surrounding: false }]) {
    expect(permittedReadingCursor(cursor, permissions)).toEqual({ chapter: "one", anchor: "cfi" });
  }
  expect(cursor.visibleText).toContain("SELECTED");
});

test("history inference copies omit attachments without mutating local authored records", () => {
  const records = [{ role: "user" as const, content: "Typed question", createdAt: "now", attachments: [{ text: "Selected" }] }];
  expect(permittedTurnRecords(records, { selection: false, surrounding: false })[0]).toMatchObject({ content: "Typed question", attachments: undefined });
  expect(records[0]!.attachments).toEqual([{ text: "Selected" }]);
});

test("tightening revokes a captured grant even through off/on; expansion alone does not", async () => {
  const policy = contextPolicyState({ selection: true, surrounding: false });
  const call = readingContextCall(policy);
  policy.set({ selection: true, surrounding: true });
  expect(call.signal.aborted).toBe(false);
  policy.set({ selection: false, surrounding: true });
  policy.set({ selection: true, surrounding: true });
  expect(call.signal.aborted).toBe(true);
  await expect(call.wait(Promise.resolve("late"))).rejects.toMatchObject({ code: "ai/context-changed" });
  call.dispose(); call.dispose(); expect(policy.listeners()).toBe(0);
});
