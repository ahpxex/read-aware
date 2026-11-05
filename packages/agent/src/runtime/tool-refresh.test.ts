import { afterEach, describe, expect, test } from "bun:test";
import { modelRequestView } from "./transcript";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Api, type Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "../chunks";
import type { ThreadScope } from "../thread-scope";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";
import { obj } from "@earendil-works/pi-schema";

async function collect(events: AsyncIterable<ThreadChunk>) {
  const chunks: ThreadChunk[] = [];
  for await (const event of events) chunks.push(event);
  return chunks;
}

const discover = (query: string) =>
  fauxAssistantMessage([fauxToolCall("get_host_capabilities", { catalog: "tools", query })], { stopReason: "toolUse" });

function tool(name: string, run: () => string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: obj({}),
    execute: async () => ({ content: [{ type: "text", text: run() }], details: undefined }),
  };
}

describe("live model tool snapshots", () => {
  let faux: FauxProviderRegistration;
  afterEach(() => faux?.unregister());

  for (const scope of [
    { kind: "book", bookId: "book" },
    { kind: "global", threadId: "ambient" },
  ] satisfies ThreadScope[]) {
    test(`${scope.kind}: live host readiness revokes cached tools and returns after recovery without resetting history`, async () => {
      faux = registerFauxProvider({ tokensPerSecond: 100_000 });
      const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book", progressPercent: 0 }] });
      let ready = true,
        calls = 0;
      deps.reader.toolContext = () => ({
        bookId: "book",
        session: true,
        ready,
        selection: true,
        controls: true,
        panels: true,
        modes: true,
        playback: true,
        imageBookId: null,
      });
      deps.reader.focus = async () => {
        calls++;
        throw Error("Must not reach host");
      };
      const seen: string[][] = [],
        history: string[] = [];
      const thread = new AgentThread({
        scope,
        deps,
        resolveModel: () => faux.getModel() as Model<Api>,
        getApiKey: () => "test",
        completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
        streamFn: (model, context, options) => {
          seen.push(modelRequestView(context).tools.map((tool) => tool.name));
          history.push(JSON.stringify(context.messages));
          if (seen.length === 2) ready = false;
          return streamSimple(model, context, options);
        },
      });
      faux.setResponses([
        discover("focus_reader"),
        fauxAssistantMessage([fauxToolCall("focus_reader", { target: "content" })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Reader is unavailable."),
      ]);
      try {
        const chunks = await collect(thread.sendTurn({ text: "Focus the reader" }));
        expect(seen[0]).not.toContain("focus_reader");
        expect(seen[1]).toContain("focus_reader");
        expect(seen[2]).not.toContain("focus_reader");
        expect(
          chunks.find((chunk) => chunk.type === "tool-step" && chunk.phase === "end" && chunk.tool === "focus_reader"),
        ).toMatchObject({ isError: true });
        expect(calls).toBe(0);
        ready = true;
        faux.setResponses([discover("focus_reader"), fauxAssistantMessage("Reader is ready again.")]);
        await collect(thread.sendTurn({ text: "Continue after recovery" }));
        expect(seen[3]).not.toContain("focus_reader");
        expect(seen[4]).toContain("focus_reader");
        expect(history[4]).toContain("Focus the reader");
      } finally {
        await thread.flushBackgroundWork();
        thread.dispose();
      }
    });
  }

  for (const scope of [{ kind: "global", threadId: "reading-features" }] satisfies ThreadScope[]) {
    test(`${scope.kind}: disabled reading actions disappear on the next request and retained definitions cannot execute`, async () => {
      faux = registerFauxProvider({ tokensPerSecond: 100_000 });
      const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book", progressPercent: 0 }] });
      const enabled = deps.readingAiActions.enabled;
      let visible = true,
        calls = 0;
      deps.readingAiActions.enabled = () => (visible ? enabled() : []);
      deps.readingAiActions.run = async (action) => {
        calls++;
        return { status: "started", action, bookId: "book" };
      };
      const seen: string[][] = [];
      const thread = new AgentThread({
        scope,
        deps,
        resolveModel: () => faux.getModel() as Model<Api>,
        getApiKey: () => "test",
        completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
        streamFn: (model, context, options) => {
          seen.push(modelRequestView(context).tools.map((tool) => tool.name));
          if (seen.length === 2) visible = false;
          return streamSimple(model, context, options);
        },
      });
      faux.setResponses([
        discover("reading_action"),
        fauxAssistantMessage([fauxToolCall("reading_action", { request: { operation: "explain" } })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("Disabled."),
      ]);
      try {
        const chunks = await collect(thread.sendTurn({ text: "Explain the selection" }));
        for (const name of ["reading_action"]) {
          expect(seen[0]).not.toContain(name);
          expect(seen[1]).toContain(name);
          expect(seen[2]).not.toContain(name);
        }
        expect(
          chunks.find(
            (chunk) => chunk.type === "tool-step" && chunk.phase === "end" && chunk.tool === "reading_action",
          ),
        ).toMatchObject({ isError: true });
        expect(calls).toBe(0);
      } finally {
        await thread.flushBackgroundWork();
        thread.dispose();
      }
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
      const target = tool("new_target", () => {
        calls.push("target");
        return "target evidence";
      });
      let available: AgentTool[] = [
        tool("enable_target", () => {
          available = [target];
          return "target enabled";
        }),
      ];
      deps.extraTools = () => {
        discoveries++;
        return available;
      };
      const thread = new AgentThread({
        scope,
        deps,
        resolveModel: () => faux.getModel() as Model<Api>,
        getApiKey: () => "test",
        completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
        streamFn: (model, context, options) => {
          seen.push({
            names: modelRequestView(context).tools.map((tool) => tool.name),
            messages: JSON.stringify(context.messages),
          });
          return streamSimple(model, context, options);
        },
      });
      faux.setResponses([
        discover("enable_target"),
        fauxAssistantMessage([fauxToolCall("enable_target", {})], { stopReason: "toolUse" }),
        discover("new_target"),
        fauxAssistantMessage([fauxToolCall("new_target", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("First answer."),
        discover("between_user_turns"),
        fauxAssistantMessage("Second answer."),
      ]);
      try {
        const chunks = await collect(
          thread.sendTurn({ text: "First question", readingCursor: { chapter: "chapter.xhtml" } }),
        );
        expect(seen[1]!.names).toContain("enable_target");
        expect(seen[0]!.names).not.toContain("new_target");
        expect(seen[2]!.names).not.toContain("enable_target");
        expect(seen[3]!.names).toContain("new_target");
        expect(seen[2]!.messages).toContain("target enabled");
        expect(seen[4]!.messages).toContain("target evidence");
        expect(calls).toEqual(["target"]);
        // A loadout change is declared in place, so each request of the turn extends the previous transcript.
        for (let round = 1; round <= 4; round++) {
          const previous = JSON.parse(seen[round - 1]!.messages) as unknown[];
          expect((JSON.parse(seen[round]!.messages) as unknown[]).slice(0, previous.length)).toEqual(previous);
        }
        const toolEnds = chunks.filter((chunk) => chunk.type === "tool-step").filter((chunk) => chunk.phase === "end");
        expect(toolEnds).toHaveLength(4);
        expect(toolEnds.every((chunk) => !chunk.isError)).toBe(true);
        available = [tool("between_user_turns", () => "unused")];
        await collect(thread.sendTurn({ text: "Second question", readingCursor: { chapter: "chapter.xhtml" } }));
        expect(seen[6]!.names).toContain("between_user_turns");
        expect(seen[6]!.names).not.toContain("new_target");
        expect(seen[6]!.messages).toContain("First question");
        expect(seen[6]!.messages).toContain("First answer.");
        expect(seen[6]!.messages).toContain("target evidence");
        expect(discoveries).toBe(7);
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
    const replacement = tool("target", () => {
      replacementCalls++;
      return "replacement result";
    });
    let available = [
      tool("target", () => {
        if (!oldActive) throw new Error("Retired registration");
        return "old result";
      }),
    ];
    deps.extraTools = () => available;
    let requests = 0;
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "replacement" },
      deps,
      resolveModel: () => faux.getModel() as Model<Api>,
      getApiKey: () => "test",
      completeFn: async () => fauxAssistantMessage('{"new": [], "reinforced": []}'),
      streamFn: (model, context, options) => {
        if (++requests === 2) {
          oldActive = false;
          available = [replacement];
        }
        return streamSimple(model, context, options);
      },
    });
    faux.setResponses([
      discover("target"),
      fauxAssistantMessage([fauxToolCall("target", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("target", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    try {
      const chunks = await collect(thread.sendTurn({ text: "Call target" }));
      const ends = chunks.filter(
        (chunk) => chunk.type === "tool-step" && chunk.phase === "end" && chunk.tool === "target",
      );
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
