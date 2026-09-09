/**
 * 运行时入口：按 scope 缓存线程实例，暴露与 ChatTransport 同形的 sendTurn。
 * 将来 apps/web 的适配器就是「new 一个 AgentRuntime + 映射 chunk 类型」这么薄。
 */
import type { ThreadChunk } from "../chunks";
import { digestBookCatchUp, digestBookTick } from "../memory/graph-upkeep";
import { runConsolidation, type ConsolidationReport } from "../memory/consolidation";
import { runMemoryBuild } from "../memory/build-policy";
import {
  accountCredential,
  createModelResolver,
  type LlmAccount,
  type RoleModels,
} from "../models/accounts";
import { createCompleteFn, createStreamFn, type CompleteFn, type StreamFn } from "../models/complete";
import type { InferencePolicy } from "../models/inference-policy";
import { buildProviderRegistry } from "../models/registry";
import type { ModelRole, RoleThinking } from "../models/roles";
import type { AgentFetch } from "../models/transport";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { askOneShot, type OneShotInput } from "./one-shot";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { AgentThread, type SendTurnInput } from "./thread";

export interface AgentRuntimeOptions {
  deps: RuntimeDeps;
  account: LlmAccount;
  models: RoleModels;
  /** 各档位的 thinking effort，缺省全 "off"（不发 thinking 参数）。 */
  thinking?: RoleThinking;
  /** HTTP transport supplied by the desktop host (Tauri native fetch in production). */
  fetch?: AgentFetch;
  inferencePolicy?: InferencePolicy;
  maxWindowTurns?: number;
  /**
   * 宿主对解析出的模型做最后修饰的接缝——产品用它注入用户配置的
   * OpenRouter 上游路由（compat.openRouterRouting），eval 用同型接缝
   * 注入 Baidu/千帆偏好。缺省恒等。
   */
  transformModel?: <T extends { provider: string; compat?: object }>(model: T) => T;
}

export class AgentRuntime {
  private readonly options: AgentRuntimeOptions;
  private readonly deps: RuntimeDeps;
  private readonly resolveModel: ReturnType<typeof createModelResolver>;
  private readonly thinking: RoleThinking;
  private readonly completeFns: Record<ModelRole, CompleteFn>;
  private readonly streamFns: Record<ModelRole, StreamFn>;
  private readonly threads = new Map<string, AgentThread>();
  private memoryRevision = 1;
  private consolidatedRevision = 0;
  private consolidationWork: Promise<ConsolidationReport | null> | null = null;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    const memory = options.deps.memory;
    this.deps = {
      ...options.deps,
      memory: {
        ...memory,
        saveMemory: async (input) => {
          const saved = await memory.saveMemory(input);
          this.memoryRevision += 1;
          return saved;
        },
        reinforceMemory: async (id) => {
          await memory.reinforceMemory(id);
          this.memoryRevision += 1;
        },
        applyMemoryChanges: async (changes) => {
          await memory.applyMemoryChanges(changes);
          if (changes.length > 0) this.memoryRevision += 1;
        },
      },
    };
    const registry = buildProviderRegistry();
    const baseResolve = createModelResolver(options.account, options.models, registry);
    this.resolveModel = options.transformModel
      ? (role) => options.transformModel!(baseResolve(role))
      : baseResolve;
    this.thinking = options.thinking ?? { smart: "off", fast: "off" };
    this.completeFns = {
      smart: createCompleteFn(
        registry,
        options.account,
        this.thinking.smart,
        options.fetch,
        options.inferencePolicy,
      ),
      fast: createCompleteFn(
        registry,
        options.account,
        this.thinking.fast,
        options.fetch,
        options.inferencePolicy,
      ),
    };
    this.streamFns = {
      smart: createStreamFn(
        registry,
        options.account,
        this.thinking.smart,
        options.fetch,
        options.inferencePolicy,
      ),
      fast: createStreamFn(
        registry,
        options.account,
        this.thinking.fast,
        options.fetch,
        options.inferencePolicy,
      ),
    };
  }

  thread(scope: ThreadScope): AgentThread {
    const key = threadScopeKey(scope);
    let thread = this.threads.get(key);
    if (!thread) {
      thread = new AgentThread({
        scope,
        deps: this.deps,
        resolveModel: this.resolveModel,
        getApiKey: () => accountCredential(this.options.account),
        completeFn: this.completeFns.fast,
        repairCompleteFn: this.completeFns.smart,
        streamFn: this.streamFns.smart,
        thinkingLevel: this.thinking.smart,
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

  /** Invalidate cached context sessions; tool definitions refresh without this. */
  invalidateAgents(): void {
    for (const thread of this.threads.values()) thread.invalidateAgent();
  }

  /** Drop one thread and its hidden rolling summary after the transcript is cleared. */
  async discardThread(scope: ThreadScope): Promise<void> {
    const key = threadScopeKey(scope);
    this.threads.get(key)?.dispose();
    this.threads.delete(key);
    await this.deps.conversations.clearInsights(key);
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
  async ask(input: OneShotInput & { schema?: never }): Promise<string>;
  async ask(input: OneShotInput & { schema: Record<string, unknown>; onText?: never }): Promise<unknown>;
  async ask(input: OneShotInput): Promise<unknown> {
    return askOneShot(input, {
      resolveModel: this.resolveModel,
      completeFns: this.completeFns,
      streamFns: this.streamFns,
      readingContextPolicy: this.deps.readingContextPolicy,
    });
  }

  /**
   * 巩固批处理（doc §4 第 3 步）：衰减、去重合并、矛盾消解、book→global 升格。
   * 由宿主在空闲时调用（产品：空闲定时器；repl：`:consolidate` 命令）。
   */
  async consolidate(): Promise<ConsolidationReport> {
    const report = await this.runConsolidation(true);
    if (!report) throw new Error("forced consolidation unexpectedly skipped");
    return report;
  }

  /**
   * Idle-maintenance entrypoint. It runs once for a fresh runtime and again only
   * after a successful memory write, so a host timer never turns into repeated
   * no-op LLM calls.
   */
  consolidateIfNeeded(): Promise<ConsolidationReport | null> {
    if (this.options.deps.memoryPolicy?.enabled() === false) return Promise.resolve(null);
    return this.runConsolidation(false);
  }

  /**
   * 章节读毕提炼（book_memory 投影 v1 的写管道；空闲节拍调用）。
   * `throughChapterHref` 是读者当前所在章——只提炼它之前的章节；缺失时
   * 仅已读完的书提炼全书。跑在 fast 档；返回本次实际提炼的章数。
   */
  async digestBook(
    bookId: Id,
    options?: { throughChapterHref?: string; maxChapters?: number },
  ): Promise<number> {
    return runMemoryBuild(this.options.deps, operation => digestBookTick({
      deps: operation.protect(this.options.deps),
      complete: operation.complete(this.completeFns.fast),
      model: this.resolveModel("fast"),
      bookId,
      throughChapterHref: options?.throughChapterHref,
      maxChapters: options?.maxChapters,
    }));
  }

  /**
   * 持续追平一本书的图谱欠账（并行批次跑到清零或 signal 中止）。
   * 宿主在阅读会话开始时调用——只要用户在读这本书，图就在后台建。
   */
  async digestBookCatchUp(
    bookId: Id,
    options?: {
      throughChapterHref?: string;
      concurrency?: number;
      signal?: AbortSignal;
      onProgress?: (digestedSoFar: number) => void;
    },
  ): Promise<number> {
    return runMemoryBuild(this.options.deps, operation => digestBookCatchUp({
      deps: operation.protect(this.options.deps),
      complete: operation.complete(this.completeFns.fast),
      model: this.resolveModel("fast"),
      bookId,
      throughChapterHref: options?.throughChapterHref,
      concurrency: options?.concurrency,
      signal: operation.signal,
      onProgress: count => { operation.assertAllowed(); options?.onProgress?.(count); },
    }), options?.signal);
  }

  private runConsolidation(force: boolean): Promise<ConsolidationReport | null> {
    if (this.consolidationWork) return this.consolidationWork;
    if (!force && this.memoryRevision === this.consolidatedRevision) {
      return Promise.resolve(null);
    }
    this.consolidationWork = runMemoryBuild(this.options.deps, async operation => {
      // Include every extraction queued before this idle pass. Writes that land
      // during the pass advance the revision and deliberately keep it dirty.
      await operation.guard(() => this.flushBackgroundWork())();
      const revision = this.memoryRevision;
      const report = await operation.guard(() => runConsolidation({
        // The pass's own merge/decay writes should not mark a second pass dirty.
        log: this.options.deps.log,
        memory: operation.protect(this.options.deps).memory,
        complete: operation.complete(this.completeFns.fast),
        model: this.resolveModel("fast"),
      }))();
      if (this.memoryRevision === revision) this.consolidatedRevision = revision;
      return report;
    }).finally(() => {
      this.consolidationWork = null;
    });
    return this.consolidationWork;
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}
