import { expect, test } from "bun:test";
import { READING_AI_ACTIONS } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReadingAiTools } from "./reading-ai-tools";

test("tool discovery follows each feature, while stale tool objects still recheck execution grants", async () => {
  const { deps } = createInMemoryDeps(); let enabled = [...READING_AI_ACTIONS], calls = 0;
  deps.readingAiActions.enabled = () => enabled;
  deps.readingAiActions.run = async action => { calls++; return { status: "started", action, bookId: "book" }; };
  const scope = { kind: "global" as const, threadId: "t" }, tools = buildReadingAiTools(scope, deps);
  expect(tools.map(tool => tool.name)).toEqual(["explain_selection", "define_term", "translate_selection", "summarize_chapter"]);
  for (const [index, action] of READING_AI_ACTIONS.entries()) {
    enabled = READING_AI_ACTIONS.filter(value => value !== action);
    expect(buildReadingAiTools(scope, deps).map(tool => tool.name)).not.toContain(tools[index]!.name);
    await expect(tools[index]!.execute("disabled", {})).rejects.toMatchObject({ code: "ui/unavailable" });
  }
  enabled = []; expect(buildReadingAiTools(scope, deps)).toEqual([]); expect(calls).toBe(0);
});

test("book tools use their own scope and global tools start book chat, with no model target/text injection", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [];
  deps.readingAiActions.run = async (...args) => { calls.push(args); return { status: "started", action: args[0], bookId: "book" }; };
  for (const scope of [{ kind: "book" as const, bookId: "book" }, { kind: "global" as const, threadId: "t" }]) {
    for (const tool of buildReadingAiTools(scope, deps)) {
      const controller = new AbortController(); await tool.execute("run", {}, controller.signal);
      expect(calls[calls.length - 1]).toEqual([expect.stringMatching(new RegExp(READING_AI_ACTIONS.join("|"))), scope.kind === "book" ? "book" : undefined, controller.signal]);
      for (const input of [{ bookId: "foreign" }, { text: "model-supplied" }, { mode: "send" }]) await expect(tool.execute("invalid", input)).rejects.toMatchObject({ code: "reader/invalid-target" });
      controller.abort(); await expect(tool.execute("aborted", {}, controller.signal)).rejects.toBeDefined();
    }
  }
  expect(calls).toHaveLength(8);
});
