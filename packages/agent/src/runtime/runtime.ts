/**
 * 运行时入口：按 scope 缓存线程实例，暴露与 ChatTransport 同形的 sendTurn。
 * 将来 apps/web 的适配器就是「new 一个 AgentRuntime + 映射 chunk 类型」这么薄。
 */
import type { ThreadChunk } from "../chunks";
import { createModelResolver, type LlmAccount, type RoleModels } from "../models/accounts";
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
  private readonly threads = new Map<string, AgentThread>();

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.resolveModel = createModelResolver(options.account, options.models);
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
        maxWindowTurns: this.options.maxWindowTurns,
      });
      this.threads.set(key, thread);
    }
    return thread;
  }

  sendTurn(scope: ThreadScope, input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    return this.thread(scope).sendTurn(input);
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}
