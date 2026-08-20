/**
 * 运行时入口：按 scope 缓存线程实例，暴露与 ChatTransport 同形的 sendTurn。
 * 将来 apps/web 的适配器就是「new 一个 AgentRuntime + 映射 chunk 类型」这么薄。
 */
import type { ThreadChunk } from "../chunks";
import { digestMissingChapters } from "../memory/chapter-digest";
import { classifyNarrativity } from "../memory/narrativity";
import { runConsolidation, type ConsolidationReport } from "../memory/consolidation";
import { findChapterByHref } from "../text/chapter-lookup";
import {
  accountCredential,
  createModelResolver,
  type LlmAccount,
  type RoleModels,
} from "../models/accounts";
import { createCompleteFn, createStreamFn, type CompleteFn, type StreamFn } from "../models/complete";
import { buildProviderRegistry } from "../models/registry";
import type { ModelRole, RoleThinking } from "../models/roles";
import type { AgentFetch } from "../models/transport";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { extractJsonObject, schemaViolations } from "../structured";
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
  maxWindowTurns?: number;
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
    this.resolveModel = createModelResolver(options.account, options.models, registry);
    this.thinking = options.thinking ?? { smart: "off", fast: "off" };
    this.completeFns = {
      smart: createCompleteFn(
        registry,
        options.account,
        this.thinking.smart,
        options.fetch,
      ),
      fast: createCompleteFn(
        registry,
        options.account,
        this.thinking.fast,
        options.fetch,
      ),
    };
    this.streamFns = {
      smart: createStreamFn(
        registry,
        options.account,
        this.thinking.smart,
        options.fetch,
      ),
      fast: createStreamFn(
        registry,
        options.account,
        this.thinking.fast,
        options.fetch,
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

  /** 工具集变化（如插件启停）后调用：所有线程下一轮以新工具重建 Agent。 */
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
      const role = input.model ?? "fast";
      const model = this.resolveModel(role);
      const context = {
        systemPrompt: system,
        messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
      };
      let message;
      if (input.onText) {
        const stream = this.streamFns[role](model, context);
        for await (const event of stream) {
          if (event.type === "text_delta") input.onText(event.delta);
        }
        message = await stream.result();
      } else {
        message = await this.completeFns[role](model, context);
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
    const deps = this.options.deps;
    const book = await deps.library.getBook(bookId);
    if (!book) return 0;
    let beforeChapterIndex: number | undefined;
    if (options?.throughChapterHref) {
      const toc = await deps.bookText.getToc(bookId).catch(() => undefined);
      const chapter = toc ? findChapterByHref(toc, options.throughChapterHref) : undefined;
      beforeChapterIndex = chapter?.index;
    }
    if (beforeChapterIndex === undefined) {
      if (book.status !== "finished") return 0;
      const toc = await deps.bookText.getToc(bookId).catch(() => undefined);
      beforeChapterIndex = toc?.length ?? 0;
    }
    // 纪要口径跟着书的叙事性走。未分类的书先分类（fast 档一次调用，落
    // book.narrativityClassified 事件）；分类失败本节拍按 narrative 保守
    // 提炼——它的产物起码无害，分类落库后口径不符的行会被重算。
    const narrativity = book.narrativity ?? (await this.classifyBookNarrativity(bookId));
    return digestMissingChapters({
      bookText: deps.bookText,
      bookMemory: deps.bookMemory,
      complete: this.completeFns.fast,
      model: this.resolveModel("fast"),
      bookId,
      beforeChapterIndex,
      maxChapters: options?.maxChapters,
      flavor: narrativity ?? "narrative",
    });
  }

  /**
   * 叙事性分类（空闲管线的前置步骤）：书名/作者 + 目录 + 正文开头样本
   * 交给 fast 模型判定，成功即经 LibraryPort 落成事件。失败返回
   * undefined（不落库，下个空闲节拍重试）；失败静默——与纪要管线同一
   * 失败哲学，但留日志痕迹的责任在宿主的 log port（若配置）。
   */
  private async classifyBookNarrativity(
    bookId: Id,
  ): Promise<"narrative" | "expository" | undefined> {
    const deps = this.options.deps;
    const book = await deps.library.getBook(bookId);
    if (!book) return undefined;
    if (book.narrativity) return book.narrativity;
    const toc = await deps.bookText.getToc(bookId).catch(() => undefined);
    if (!toc?.length) return undefined;
    // 正文样本：跳过版权页等空转小节，取第一段像样的实文。
    let sampleText = "";
    for (let index = 0; index < Math.min(toc.length, 8) && sampleText.length < 600; index++) {
      const text = await deps.bookText.getChapterText(bookId, index).catch(() => undefined);
      if (text && text.trim().length > sampleText.length) sampleText = text.trim();
    }
    if (!sampleText) return undefined;
    const narrativity = await classifyNarrativity({
      complete: this.completeFns.fast,
      model: this.resolveModel("fast"),
      title: book.title,
      author: book.author,
      toc,
      sampleText,
    });
    if (!narrativity) return undefined;
    try {
      await deps.library.setBookNarrativity(bookId, narrativity);
    } catch {
      return undefined;
    }
    return narrativity;
  }

  private runConsolidation(force: boolean): Promise<ConsolidationReport | null> {
    if (this.consolidationWork) return this.consolidationWork;
    if (!force && this.memoryRevision === this.consolidatedRevision) {
      return Promise.resolve(null);
    }
    this.consolidationWork = (async () => {
      // Include every extraction queued before this idle pass. Writes that land
      // during the pass advance the revision and deliberately keep it dirty.
      await this.flushBackgroundWork();
      const revision = this.memoryRevision;
      const report = await runConsolidation({
        // The pass's own merge/decay writes should not mark a second pass dirty.
        memory: this.options.deps.memory,
        complete: this.completeFns.fast,
        model: this.resolveModel("fast"),
      });
      if (this.memoryRevision === revision) this.consolidatedRevision = revision;
      return report;
    })().finally(() => {
      this.consolidationWork = null;
    });
    return this.consolidationWork;
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}
