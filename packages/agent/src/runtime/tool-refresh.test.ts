import { afterEach, describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Api, type Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall, type FauxProviderRegistration } from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "../chunks";
import type { ThreadScope } from "../thread-scope";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

async function collect(events: AsyncIterable<ThreadChunk>) {
  const chunks: ThreadChunk[] = [];
  for await (const event of events) chunks.push(event);
  return chunks;
}

function tool(name: string, run: () => string): AgentTool {
  return {
    name, label: name, description: name, parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: run() }], details: undefined }),
  };
}

describe("live model tool snapshots", () => {
  let faux: FauxProviderRegistration;
  afterEach(() => faux?.unregister());

  for (const scope of [{ kind: "book", bookId: "book" }, { kind: "global", threadId: "reading-features" }] satisfies ThreadScope[]) {
    test(`${scope.kind}: disabled reading actions disappear on the next request and retained definitions cannot execute`, async () => {
      faux = registerFauxProvider({ tokensPerSecond: 100_000 });
      const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book", progressPercent: 0 }] });
      const enabled = deps.readingAiActions.enabled;
      let visible = true, calls = 0;
      deps.readingAiActions.enabled = () => visible ? enabled() : [];
      deps.readingAiActions.run = async action => { calls++; return { status: "started", action, bookId: "book" }; };
      const seen: string[][] = [];
      const thread = new AgentThread({ scope, deps, resolveModel: () => faux.getModel() as Model<Api>, getApiKey: () => "test",
        completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
        streamFn: (model, context, options) => {
          seen.push(context.tools?.map(tool => tool.name) ?? []);
          visible = false;
          return streamSimple(model, context, options);
        },
      });
      faux.setResponses([fauxAssistantMessage([fauxToolCall("explain_selection", {})], { stopReason: "toolUse" }), fauxAssistantMessage("Disabled.")]);
      try {
        const chunks = await collect(thread.sendTurn({ text: "Explain the selection" }));
        for (const name of ["explain_selection", "define_term", "translate_selection", "summarize_chapter"]) {
          expect(seen[0]).toContain(name); expect(seen[1]).not.toContain(name);
        }
        expect(chunks.find(chunk => chunk.type === "tool-step" && chunk.phase === "end")).toMatchObject({ isError: true });
        expect(calls).toBe(0);
      } finally { await thread.flushBackgroundWork(); thread.dispose(); }
    });
  }

  for (const scope of [
    { kind: "book", bookId: "book" as Id },
    { kind: "global", threadId: "refresh" },
  ] satisfies ThreadScope[]) {
    test(`${scope.kind}: refreshes discovery and execution between model requests, preserving results and history`, async () => {
      faux = registerFauxProvider({ tokensPerSecond: 100_000 });
      const { deps } = createInMemoryDeps({ books: [{ id: "book" as Id, title: "Book", progressPercent: 0 }] });
      const seen: Array<{ names: string[]; messages: string }> = [];
      const calls: string[] = [];
      let discoveries = 0;
      const target = tool("new_target", () => { calls.push("target"); return "target evidence"; });
      let available: AgentTool[] = [tool("enable_target", () => {
        available = [target];
        return "target enabled";
      })];
      deps.extraTools = () => { discoveries++; return available; };
      const thread = new AgentThread({
        scope, deps, resolveModel: () => faux.getModel() as Model<Api>, getApiKey: () => "test",
        completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
        streamFn: (model, context, options) => {
          seen.push({ names: context.tools?.map(tool => tool.name) ?? [], messages: JSON.stringify(context.messages) });
          return streamSimple(model, context, options);
        },
      });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("enable_target", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("new_target", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("First answer."),
        fauxAssistantMessage("Second answer."),
      ]);
      try {
        const chunks = await collect(thread.sendTurn({ text: "First question", readingCursor: { chapter: "chapter.xhtml" } }));
        expect(seen[0]!.names).toContain("enable_target");
        expect(seen[0]!.names).not.toContain("new_target");
        expect(seen[1]!.names).not.toContain("enable_target");
        expect(seen[1]!.names).toContain("new_target");
        expect(seen[1]!.messages).toContain("target enabled");
        expect(seen[2]!.messages).toContain("target evidence");
        expect(calls).toEqual(["target"]);
        const toolEnds = chunks.filter(chunk => chunk.type === "tool-step").filter(chunk => chunk.phase === "end");
        expect(toolEnds).toHaveLength(2);
        expect(toolEnds.every(chunk => !chunk.isError)).toBe(true);
        available = [tool("between_user_turns", () => "unused")];
        await collect(thread.sendTurn({ text: "Second question", readingCursor: { chapter: "chapter.xhtml" } }));
        expect(seen[3]!.names).toContain("between_user_turns");
        expect(seen[3]!.names).not.toContain("new_target");
        expect(seen[3]!.messages).toContain("First question");
        expect(seen[3]!.messages).toContain("First answer.");
        expect(seen[3]!.messages).toContain("target evidence");
        expect(discoveries).toBe(4);
      } finally {
        await thread.flushBackgroundWork();
        thread.dispose();
      }
    });
  }

  test("an outstanding response keeps its original callback; replacement is discovered only on the next request", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const { deps } = createInMemoryDeps();
    let oldActive = true;
    let replacementCalls = 0;
    const replacement = tool("target", () => { replacementCalls++; return "replacement result"; });
    let available = [tool("target", () => {
      if (!oldActive) throw new Error("Retired registration");
      return "old result";
    })];
    deps.extraTools = () => available;
    let requests = 0;
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "replacement" }, deps,
      resolveModel: () => faux.getModel() as Model<Api>, getApiKey: () => "test",
      completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
      streamFn: (model, context, options) => {
        if (++requests === 1) {
          oldActive = false;
          available = [replacement];
        }
        return streamSimple(model, context, options);
      },
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("target", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("target", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    try {
      const chunks = await collect(thread.sendTurn({ text: "Call target" }));
      const ends = chunks.filter(chunk => chunk.type === "tool-step" && chunk.phase === "end");
      expect(ends).toHaveLength(2);
      expect(ends[0]).toMatchObject({ isError: true, output: "Retired registration" });
      expect(ends[1]).toMatchObject({ isError: false, output: "replacement result" });
      expect(replacementCalls).toBe(1);
    } finally {
      await thread.flushBackgroundWork();
      thread.dispose();
    }
  });
});
