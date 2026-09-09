import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import { AgentThread } from "../runtime/thread";
import { createInMemoryDeps } from "./fixtures";

/** Scripted model transport for the desktop Worker probe, never a production provider. */
export async function runToolRefreshLoop(options: {
  extraTools: NonNullable<RuntimeDeps["extraTools"]>;
  arm: string;
  target: string;
  beforeResponse: (request: number) => Promise<void>;
}) {
  const model: Model<Api> = { id: "scripted-tool-refresh", name: "Scripted tool refresh", api: "openai-completions",
    provider: "openai", baseUrl: "https://unused.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000 };
  const message = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
    role: "assistant", api: model.api, provider: model.provider, model: model.id, content, stopReason, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } },
  });
  let callId = 0;
  const call = (name: string) => message([{ type: "toolCall", id: `probe-${++callId}`, name, arguments: {} }], "toolUse");
  const responses = [call(options.arm), call(options.target), call(options.target), call(options.arm), call(options.target), message([{ type: "text", text: "First result." }]),
    call(options.target), call(options.target), message([{ type: "text", text: "Second result." }])];
  const { deps } = createInMemoryDeps();
  deps.extraTools = options.extraTools;
  const snapshots: Array<{ tools: string[]; messages: string }> = [];
  const ends: Array<{ tool: string; isError?: boolean; output?: string }> = [];
  const thread = new AgentThread({ scope: { kind: "global", threadId: "capability-tool-refresh" }, deps,
    resolveModel: () => model, getApiKey: () => "test",
    completeFn: async () => message([{ type: "text", text: '{"new": [], "reinforced": []}' }]),
    streamFn: (_model, context) => {
      snapshots.push({ tools: context.tools?.map(tool => tool.name) ?? [], messages: JSON.stringify(context.messages) });
      const output = createAssistantMessageEventStream();
      void (async () => {
        try {
          await options.beforeResponse(snapshots.length);
          const response = responses.shift();
          if (!response) throw Error("Scripted responses exhausted");
          output.push({ type: "start", partial: response });
          output.push({ type: "done", reason: response.stopReason === "toolUse" ? "toolUse" : "stop", message: response });
        } catch (error) {
          output.push({ type: "error", reason: "error", error: { ...message([], "error"), errorMessage: String(error) } });
        }
      })();
      return output;
    },
  });
  try {
    for (const text of ["First request", "Second request"]) {
      for await (const chunk of thread.sendTurn({ text })) {
        if (chunk.type === "tool-step" && chunk.phase === "end") ends.push(chunk);
      }
    }
    return { snapshots, ends };
  } finally {
    await thread.flushBackgroundWork(); thread.dispose();
  }
}
