/**
 * Phase 0 spike（docs/agent-architecture.md §12）：验证 pi 的两条关键路径 ——
 *   A. pi-ai 直接流式（BYOK apiKey 显式传入）
 *   B. pi-agent-core Agent 循环 + 自定义工具端到端
 *
 * 独立运行：`bun run spike`（见 spike-run.ts），不接产品。
 * spike 结论落地后此文件删除，不要在产品代码里引用。
 */
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Api, type Model } from "@earendil-works/pi-ai";
import { buildProviderRegistry, type KnownProviderId, type ProviderRegistry } from "./models/registry";

export interface SpikeConfig {
  provider: KnownProviderId;
  apiKey: string;
  model: string;
}

export interface SpikeReport {
  model: string;
  /** A：直接流式收到的 text_delta 数量与拼出的文本 */
  streamDeltas: number;
  streamText: string;
  /** B：Agent 循环是否真的执行了自定义工具，以及最终回答 */
  toolCalled: boolean;
  agentText: string;
  agentEvents: string[];
}

function resolveSpikeModel(models: ProviderRegistry, config: SpikeConfig): Model<Api> {
  const exact = models.getModel(config.provider, config.model);
  if (exact) return exact;
  // 配置里的 model id 不在 pi 的静态目录里时，克隆同 provider 的任一模型并覆盖 id
  const fallback = models.getModels(config.provider)[0];
  if (!fallback) throw new Error(`spike: no models for provider ${config.provider}`);
  return { ...fallback, id: config.model };
}

function lastAssistantText(agent: Agent): string {
  for (let i = agent.state.messages.length - 1; i >= 0; i--) {
    const message = agent.state.messages[i];
    if ("role" in message && message.role === "assistant" && Array.isArray(message.content)) {
      return message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
    }
  }
  return "";
}

export async function runPiSpike(
  config: SpikeConfig,
  log: (line: string) => void = (line) => console.log(line),
): Promise<SpikeReport> {
  const models = buildProviderRegistry();
  const model = resolveSpikeModel(models, config);
  log(`[spike] model resolved: ${model.provider}/${model.id}`);

  // —— A：pi-ai 直接流式 ——
  let streamDeltas = 0;
  let streamText = "";
  const stream = models.streamSimple(
    model,
    {
      messages: [
        { role: "user", content: "Reply with exactly: PI_SPIKE_OK", timestamp: Date.now() },
      ],
    },
    { apiKey: config.apiKey },
  );
  for await (const event of stream) {
    if (event.type === "text_delta") {
      streamDeltas++;
      streamText += event.delta;
    } else if (event.type === "error") {
      throw new Error(`[spike] stream error: ${JSON.stringify(event)}`);
    }
  }
  log(`[spike] A ok — ${streamDeltas} deltas, text: ${JSON.stringify(streamText.trim())}`);

  // —— B：Agent 循环 + 自定义工具 ——
  let toolCalled = false;
  const listBooks: AgentTool = {
    name: "list_books",
    label: "List books",
    description: "List the books on the user's shelf.",
    parameters: Type.Object({}),
    execute: async () => {
      toolCalled = true;
      log("[spike] tool list_books executed");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { title: "The Dawn of Everything" },
              { title: "Debt: The First 5000 Years" },
              { title: "Bullshit Jobs" },
            ]),
          },
        ],
        details: undefined,
      };
    },
  };
  const agentEvents: string[] = [];
  const agent = new Agent({
    initialState: {
      systemPrompt:
        "You are a reading assistant. Use the list_books tool to inspect the user's shelf before answering.",
      model,
      tools: [listBooks],
    },
    getApiKey: () => config.apiKey,
  });
  agent.subscribe((event) => {
    agentEvents.push(event.type);
  });
  await agent.prompt(
    "How many books are on my shelf? Answer with just the number.",
  );
  await agent.waitForIdle();
  const agentText = lastAssistantText(agent);
  log(`[spike] B ok — toolCalled=${toolCalled}, answer: ${JSON.stringify(agentText.trim())}`);

  return {
    model: `${model.provider}/${model.id}`,
    streamDeltas,
    streamText: streamText.trim(),
    toolCalled,
    agentText: agentText.trim(),
    agentEvents,
  };
}
