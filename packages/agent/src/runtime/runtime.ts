/**
 * 运行时入口：按 scope 缓存线程实例，暴露与 ChatTransport 同形的 sendTurn。
 * 将来 apps/web 的适配器就是「new 一个 AgentRuntime + 映射 chunk 类型」这么薄。
 */
import type { ThreadChunk } from "../chunks";
import { runConsolidation, type ConsolidationReport } from "../memory/consolidation";
import { createModelResolver, type LlmAccount, type RoleModels } from "../models/accounts";
import { createCompleteFn, createStreamFn, type CompleteFn, type StreamFn } from "../models/complete";
import { buildProviderRegistry } from "../models/registry";
import type { RuntimeDeps } from "../ports";
import { extractJsonObject, schemaViolations } from "../structured";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { AgentThread, type SendTurnInput } from "./thread";

export interface AgentRuntimeOptions {
  deps: RuntimeDeps;
  account: LlmAccount;
  models: RoleModels;
  maxWindowTurns?: number;
}

export class AgentRuntime {
  private readonly options: AgentRuntimeOptions;
  private readonly resolveModel: ReturnType<typeof createModelResolver>;
  private readonly completeFn: CompleteFn;
  private readonly streamFn: StreamFn;
  private readonly threads = new Map<string, AgentThread>();

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    const registry = buildProviderRegistry();
    this.resolveModel = createModelResolver(options.account, options.models, registry);
    this.completeFn = createCompleteFn(registry, options.account);
    this.streamFn = createStreamFn(registry, options.account);
  }

  thread(scope: ThreadScope): AgentThread {
    const key = threadScopeKey(scope);
    let thread = this.threads.get(key);
    if (!thread) {
      thread = new AgentThread({
        scope,
        deps: this.options.deps,
        resolveModel: this.resolveModel,
        getApiKey: () => this.options.account.apiKey,
        completeFn: this.completeFn,
        maxWindowTurns: this.options.maxWindowTurns,
      });
      this.threads.set(key, thread);
    }
    return thread;
  }

  sendTurn(scope: ThreadScope, input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    return this.thread(scope).sendTurn(input);
  }

  /** 等待所有线程的后台管道（记忆提炼 + 滚动摘要）排空。 */
  async flushBackgroundWork(): Promise<void> {
    await Promise.all([...this.threads.values()].map((thread) => thread.flushBackgroundWork()));
  }

  /** 工具集变化（如插件启停）后调用：所有线程下一轮以新工具重建 Agent。 */
  invalidateAgents(): void {
    for (const thread of this.threads.values()) thread.invalidateAgent();
  }

  /**
   * 一次性快问（无线程、无记忆、无工具）：宿主的轻量 LLM 入口 ——
   * 产品侧用于插件的 `llm` 权限域。走 fast 档模型。
   *
   * 带 `schema` 时是结构化模式：指示模型只回 JSON、解析并对照 schema
   * 校验（structured.ts 的子集语义），首次失败携带违例清单重试一次，
   * 仍失败则抛出。返回的是已解析、已校验的对象。
   *
   * 带 `onText` 时流式回调文本增量（最终仍 resolve 完整文本）。流式与
   * schema 互斥——结构化答案没有可读的中间态。
   */
  async ask(input: {
    prompt: string;
    system?: string;
    model?: "fast" | "smart";
    onText?: (delta: string) => void;
  }): Promise<string>;
  async ask(input: {
    prompt: string;
    system?: string;
    model?: "fast" | "smart";
    schema: Record<string, unknown>;
  }): Promise<unknown>;
  async ask(input: {
    prompt: string;
    system?: string;
    model?: "fast" | "smart";
    schema?: Record<string, unknown>;
    onText?: (delta: string) => void;
  }): Promise<unknown> {
    if (input.schema && input.onText) {
      throw new Error("ask: schema and onText are mutually exclusive");
    }
    const complete = async (system: string | undefined, prompt: string): Promise<string> => {
      const model = this.resolveModel(input.model ?? "fast");
      const context = {
        systemPrompt: system,
        messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
      };
      let message;
      if (input.onText) {
        const stream = this.streamFn(model, context);
        for await (const event of stream) {
          if (event.type === "text_delta") input.onText(event.delta);
        }
        message = await stream.result();
      } else {
        message = await this.completeFn(model, context);
      }
      // completeSimple 不 reject：失败 resolve 成 stopReason "error"/"aborted"。
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw new Error(message.errorMessage ?? "ask failed");
      }
      return message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
    };

    if (!input.schema) return complete(input.system, input.prompt);

    const instruction =
      "Return ONLY a single JSON object — no prose, no markdown, no code fences. " +
      `It must validate against this JSON Schema:\n${JSON.stringify(input.schema)}`;
    const system = input.system ? `${input.system}\n\n${instruction}` : instruction;

    let feedback = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt =
        attempt === 0
          ? input.prompt
          : `${input.prompt}\n\nYour previous reply was invalid (${feedback}). ` +
            "Reply again with ONLY the corrected JSON object.";
      const text = await complete(system, prompt);
      try {
        const value: unknown = JSON.parse(extractJsonObject(text));
        const problems = schemaViolations(value, input.schema);
        if (problems.length === 0) return value;
        feedback = problems.slice(0, 5).join("; ");
      } catch (error) {
        feedback = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`structured ask failed schema validation: ${feedback}`);
  }

  /**
   * 巩固批处理（doc §4 第 3 步）：衰减、去重合并、矛盾消解、book→global 升格。
   * 由宿主在空闲时调用（产品：空闲定时器；repl：`:consolidate` 命令）。
   */
  consolidate(): Promise<ConsolidationReport> {
    return runConsolidation({
      memory: this.options.deps.memory,
      complete: this.completeFn,
      model: this.resolveModel("fast"),
    });
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}
