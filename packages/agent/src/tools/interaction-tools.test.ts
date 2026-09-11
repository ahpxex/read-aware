import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildInteractionTools } from "./interaction-tools";
import type { UserInteractionToolDetails } from "./user-interaction";
import { validateToolArguments } from "@earendil-works/pi-ai";

describe("ask_user", () => {
  test("suspends until the host resolves the in-chat question", async () => {
    const { deps, stores } = createInMemoryDeps();
    let resolveAnswer: ((answer: { text: string }) => void) | undefined;
    deps.interactions.request = (request) => {
      stores.interactions.push(request);
      return new Promise((resolve) => {
        resolveAnswer = resolve;
      });
    };
    const updates: AgentToolResult<UserInteractionToolDetails>[] = [];
    const tool = buildInteractionTools({ kind: "global", threadId: "thread-1" }, deps).find(
      (candidate) => candidate.name === "ask_user",
    );
    if (!tool) throw new Error("ask_user was not registered");

    let settled = false;
    const execution = tool
      .execute(
        "call-1",
        {
          question: "Which direction should I take?",
          options: [
            { id: "summary", label: "Summarize" },
            { id: "compare", label: "Compare", description: "Contrast the two books" },
          ],
        },
        undefined,
        (update) => updates.push(update as AgentToolResult<UserInteractionToolDetails>),
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(stores.interactions).toHaveLength(1);
    expect(stores.interactions[0]).toMatchObject({
      id: "global:thread-1:call-1",
      kind: "question",
      allowCustom: true,
    });
    expect(updates[0]?.details).toMatchObject({
      type: "user-interaction",
      phase: "request",
    });

    resolveAnswer?.({ text: "A custom answer" });
    const result = await execution;
    expect(settled).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({ answered: true, answer: "A custom answer" }),
    });
    expect(updates[updates.length - 1]?.details).toMatchObject({
      type: "user-interaction",
      phase: "response",
      answer: { text: "A custom answer" },
    });
  });
});

test("ask_user_form suspends in both scopes and returns typed data, not an approval", async () => {
  for (const scope of [{ kind: "global" as const, threadId: "thread-1" }, { kind: "book" as const, bookId: "book-1" }]) {
    const { deps, stores } = createInMemoryDeps();
    const tool = buildInteractionTools(scope, deps).find(item => item.name === "ask_user_form")!;
    const params = { title: "Reading plan", fields: [
      { id: "minutes", kind: "number", label: "Minutes", min: 1, required: true },
      { id: "weekends", kind: "checkbox", label: "Weekends" },
    ] };
    expect(validateToolArguments(tool, { type: "toolCall", id: "form", name: tool.name, arguments: params })).toEqual(params);
    let finish!: (answer: { values: { minutes: number; weekends: boolean } }) => void;
    deps.interactions.request = request => { stores.interactions.push(request); return new Promise(resolve => { finish = resolve; }); };
    const pending = tool.execute("form", params);
    expect(stores.interactions[0]).toMatchObject({ kind: "form", title: "Reading plan" });
    finish({ values: { minutes: 20, weekends: false } });
    expect((await pending).content[0]).toMatchObject({ type: "text", text: JSON.stringify({ answered: true, values: { minutes: 20, weekends: false } }) });
    deps.interactions.request = async () => ({ cancelled: true });
    expect((await tool.execute("skip", params)).content[0]).toMatchObject({ type: "text", text: JSON.stringify({ answered: false, reason: "The user skipped the form." }) });
    deps.interactions.request = async () => ({ optionId: "approve", values: { minutes: -1 } });
    await expect(tool.execute("invalid", params)).rejects.toMatchObject({ code: "ai/invalid-interaction" });
  }
});
