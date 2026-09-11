import { expect, test } from "bun:test";
import { fixture } from "./fixture";
import { registerGoalMemory } from "../src/memory-status";
import { readGoalState, writeGoal } from "../src/goals";
import { memoryCopy } from "../src/memory-strings";

test("goal results correlate requests and revisions, with errors and no stale success on a newer goal", async () => {
  const { ctx } = fixture(), memory = registerGoalMemory(ctx);
  await writeGoal(ctx, "book-1", { text: "Understand evidence", suggestMemory: true }, null);
  const input = { requestId: "one", scope: { kind: "book" as const, bookId: "book-1" }, userText: "q", assistantText: "a" };
  expect(JSON.stringify(await memory.view())).toContain("No result");
  await memory.provider.propose(input);
  expect(JSON.stringify(await memory.view())).toContain("Awaiting host result");
  memory.provider.onResult!({ requestId: "one", discarded: 0, results: [{ index: 0, outcome: { status: "saved" } }] });
  expect(JSON.stringify(await memory.view())).toContain("Saved to memory");
  await memory.provider.propose({ ...input, requestId: "two" });
  memory.provider.onResult!({ requestId: "one", discarded: 0, results: [{ index: 0, outcome: { status: "saved" } }] });
  expect(JSON.stringify(await memory.view())).toContain("Awaiting host result");
  memory.provider.onResult!({ requestId: "two", discarded: 0, results: [{ index: 0, outcome: { status: "failed", errorCode: "db/locked" } }] });
  expect(JSON.stringify(await memory.view())).toContain('"code":"db/locked"');
  const state = await readGoalState(ctx, "book-1");
  await writeGoal(ctx, "book-1", { text: "A new goal", suggestMemory: true }, state.revision);
  expect(JSON.stringify(await memory.view())).toContain("No result");
});

test("result display follows the selected book; an open result refresh keeps its original target", async () => {
  const f = fixture(), memory = registerGoalMemory(f.ctx);
  await writeGoal(f.ctx, "book-1", { text: "Remember", suggestMemory: true }, null);
  await memory.provider.propose({ requestId: "one", scope: { kind: "book", bookId: "book-1" }, userText: "", assistantText: "" });
  memory.provider.onResult!({ requestId: "one", discarded: 0, results: [{ index: 0, outcome: { status: "rejected", reason: "duplicate" } }] });
  const view = await memory.view();
  expect(JSON.stringify(view)).toContain("Matching content already known");
  f.state.bookId = "book-2";
  expect(JSON.stringify(await memory.view())).toContain("No result");
  if (view.kind !== "detail") throw Error("Expected detail");
  expect(JSON.stringify(await view.actions![0]!.run())).toContain("Matching content already known");
});

test("all eight product locales have complete memory result labels", () => {
  const keys = Object.keys(memoryCopy("en"));
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    expect(Object.keys(memoryCopy(locale))).toEqual(keys);
    expect(Object.values(memoryCopy(locale)).every(value => value.length > 0)).toBe(true);
    if (locale !== "en") expect(memoryCopy(locale).title).not.toBe(memoryCopy("en").title);
  }
});
