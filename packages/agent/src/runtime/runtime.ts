/**
 * 运行时入口：按 scope 缓存线程实例，暴露与 ChatTransport 同形的 sendTurn。
 * 将来 apps/web 的适配器就是「new 一个 AgentRuntime + 映射 chunk 类型」这么薄。
 */
import type { ThreadChunk } from "../chunks";
import { runConsolidation, type ConsolidationReport } from "../memory/consolidation";
import { createModelResolver, type LlmAccount, type RoleModels } from "../models/accounts";
import { createCompleteFn, type CompleteFn } from "../models/complete";
import { buildProviderRegistry } from "../models/registry";
import type { RuntimeDeps } from "../ports";
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
  private readonly threads = new Map<string, AgentThread>();

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    const registry = buildProviderRegistry();
    this.resolveModel = createModelResolver(options.account, options.models, registry);
    this.completeFn = createCompleteFn(registry, options.account);
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

  /**
   * 巩固批处理（doc §4 第 3 步）：衰减、去重合并、矛盾消解、book→global 升格。
   * 由宿主在空闲时调用（产品：空闲定时器；lab：手动按钮）。
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
