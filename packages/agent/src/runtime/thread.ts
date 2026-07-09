/**
 * 一个线程 = 一个 pi Agent 实例（doc §5 runtime/）。
 * 职责：从 ConversationPort 水化转录、装配 system prompt（书线程每个章节
 * 会话一次、会话内冻结；全局线程每轮重建）、把 pi 的事件流翻译成
 * ThreadChunk、轮末持久化两条 TurnRecord（doc §10）。
 * 书线程按**章节会话**装配上下文：同章节连续，换章节发新消息才重置（doc §5）。
 */
import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Usage } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import { buildSystemPrompt } from "../context/system-prompt";
import { extractMemories } from "../memory/extraction";
import { updateRollingSummary } from "../memory/rolling-summary";
import type { CompleteFn } from "../models/complete";
import type { ResolveModel } from "../models/roles";
import type { RuntimeDeps } from "../ports";
import { findChapterByHref } from "../text/chapter-lookup";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { buildBookTextTools } from "../tools/book-text-tools";
import { buildConversationTools } from "../tools/conversation-tools";
import { buildThreadTools } from "../tools/library-tools";
import { buildMemoryTools, visibleScopes } from "../tools/memory-tools";
import { buildVocabularyTools } from "../tools/vocabulary-tools";
import { AsyncQueue } from "./async-queue";
import { elideStaleToolResults } from "./context-slim";
import { lastAssistantText, lastTurnTail, turnRecordsToMessages } from "./history";
import { windowByTurns } from "./windowing";

export interface SelectionAttachment {
  /** 选中的原文（"Ask AI about this" 的 context chip） */
  text: string;
  chapter?: string;
  /** 选区锚点（CFI 等）；ask-note 优先锚在这里 */
  anchor?: string;
}

export interface SendTurnInput {
  text: string;
  attachments?: SelectionAttachment[];
  /** 发送时刻的当前阅读位置；无选区时 ask-note 锚在这里（doc §7） */
  positionAnchor?: string;
  /** 发送时刻所在章节（href）—— 书线程章节会话的边界信号（doc §5） */
  chapter?: string;
  signal?: AbortSignal;
}

export interface AgentThreadOptions {
  scope: ThreadScope;
  deps: RuntimeDeps;
  resolveModel: ResolveModel;
  getApiKey: (provider: string) => string | undefined;
  /** 后台管道（记忆提炼）的补全调用，跑在 fast 档位上 */
  completeFn: CompleteFn;
  /** transformContext 窗口大小（用户轮数），默认 12 */
  maxWindowTurns?: number;
}

const DEFAULT_WINDOW_TURNS = 12;

function formatUserMessage(input: SendTurnInput): string {
  if (!input.attachments?.length) return input.text;
  const quoted = input.attachments
    .map((attachment) => {
      const body = attachment.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return attachment.chapter ? `${body}\n> — ${attachment.chapter}` : body;
    })
    .join("\n\n");
  return `${quoted}\n\n${input.text}`;
}

export class AgentThread {
  readonly scope: ThreadScope;
  readonly key: string;

  private readonly deps: RuntimeDeps;
  private readonly resolveModel: ResolveModel;
  private readonly getApiKey: (provider: string) => string | undefined;
  private readonly completeFn: CompleteFn;
  private readonly maxWindowTurns: number;

  private agent: Agent | undefined;
  private busy = false;
  private backgroundWork: Promise<void> = Promise.resolve();
  /**
   * 书线程的章节会话（doc §5）：会话内 agent.state 连续累积（含工具调用的
   * 完整上下文树）；仅当用户在**另一个章节**发出新消息时才重置回无状态基线。
   * 纯内存 —— 运行时重建/重启后自然回落到基线装配。
   */
  private sessionStarted = false;
  private sessionChapter: string | undefined;

  constructor(options: AgentThreadOptions) {
    this.scope = options.scope;
    this.key = threadScopeKey(options.scope);
    this.deps = options.deps;
    this.resolveModel = options.resolveModel;
    this.getApiKey = options.getApiKey;
    this.completeFn = options.completeFn;
    this.maxWindowTurns = options.maxWindowTurns ?? DEFAULT_WINDOW_TURNS;
  }

  /** 等待后台管道（记忆提炼）排空 —— 测试与关闭线程时用。 */
  flushBackgroundWork(): Promise<void> {
    return this.backgroundWork;
  }

  /**
   * 首次使用时创建 Agent。全局线程从转录 store 水化历史（线程内连续）；
   * 书线程不水化 —— 章节会话首轮由 sendTurn 重置为"一轮尾巴"基线。
   */
  private async ensureAgent(): Promise<Agent> {
    if (this.agent) return this.agent;
    const model = this.resolveModel("smart");
    const records =
      this.scope.kind === "book" ? [] : await this.deps.conversations.load(this.key);
    const agent = new Agent({
      initialState: {
        model,
        tools: [
          ...buildThreadTools(this.scope, this.deps),
          ...buildMemoryTools(this.scope, this.deps),
          ...buildConversationTools(this.scope, this.deps),
          ...buildBookTextTools(this.scope, this.deps),
          ...buildVocabularyTools(this.deps),
        ],
        messages: turnRecordsToMessages(records, model),
      },
      transformContext: async (messages) =>
        elideStaleToolResults(windowByTurns(messages, this.maxWindowTurns)),
      // Agent 不转发 cacheRetention，只能在 streamFn 这层补：一轮多次往返共享
      // 同一前缀（system prompt 轮内稳定），Anthropic 式显式缓存在这里全是净赚；
      // 不支持的 provider 由 pi 忽略。
      streamFn: (model, context, options) =>
        streamSimple(model, context, { ...options, cacheRetention: "short" }),
      getApiKey: this.getApiKey,
    });
    this.agent = agent;
    return agent;
  }

  private async refreshSystemPrompt(agent: Agent, currentChapterHref?: string): Promise<void> {
    const wantsPosition = this.scope.kind === "book" && !!currentChapterHref;
    const [profile, book, shelf, memories, conversationSummary, toc] = await Promise.all([
      this.deps.profile.getProfileSummary(),
      this.scope.kind === "book" ? this.deps.library.getBook(this.scope.bookId) : undefined,
      this.scope.kind === "global" ? this.deps.library.listBooks() : undefined,
      this.deps.memory.searchMemories({ scopes: visibleScopes(this.scope), limit: 8 }),
      this.deps.conversations.getInsights(this.key),
      // 位置反查要 hrefs，只有书线程带着章节 href 时才取目录
      wantsPosition && this.scope.kind === "book"
        ? this.deps.bookText.getToc(this.scope.bookId).catch(() => undefined)
        : undefined,
    ]);
    const chapter =
      toc && currentChapterHref ? findChapterByHref(toc, currentChapterHref) : undefined;
    agent.state.systemPrompt = buildSystemPrompt(this.scope, {
      book,
      currentChapter: chapter && { index: chapter.index, title: chapter.title },
      profile,
      shelfSize: shelf?.length,
      memories,
      conversationSummary,
      // 全局线程首次使用且画像为空 → 访谈模式（onboarding 的对话半场，doc §9）
      onboardingInterview:
        this.scope.kind === "global" && !profile && agent.state.messages.length === 0,
    });
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    if (this.busy) throw new Error(`thread ${this.key} is already streaming a turn`);
    this.busy = true;
    const queue = new AsyncQueue<AgentEvent>();
    let unsubscribe: (() => void) | undefined;
    // 只有干净收尾的轮次才留在章节会话里；中断/报错后 agent.state 形状
    // 不可信，下一轮从持久记录重建基线（等价于今天的无状态装配）。
    let turnCompleted = false;
    try {
      const agent = await this.ensureAgent();
      // 本轮所在章节：选区的章节优先于阅读位置（问哪段话,会话就属于哪章）。
      // 双重职责：章节会话的边界信号 + system prompt 的阅读位置锚定。
      const turnChapter = input.attachments?.[0]?.chapter ?? input.chapter;
      if (this.scope.kind === "book") {
        // 书线程章节会话（doc §5）：同章节内的轮次共享同一个上下文树
        // （agent.state 连续累积，windowByTurns 封顶）；当且仅当这条消息
        // 发自另一个章节时，才把 state 重置回无状态基线 —— 上一轮
        // user↔assistant 原文（覆盖"那第二点呢？"式的明显 follow-up）加上
        // system prompt 里的滚动摘要；更早的历史 agent 用 get_recent_turns /
        // search_conversation 拉取。章节未知（选区与阅读位置都没带 href）
        // 不算换章。UI 的连续转录在持久层，不受影响。
        const crossedChapter =
          turnChapter !== undefined &&
          this.sessionChapter !== undefined &&
          turnChapter !== this.sessionChapter;
        if (!this.sessionStarted || crossedChapter) {
          // system prompt 只在会话开始装配一次（含阅读位置快照），会话内
          // 冻结 —— 前缀头部字节级稳定，同章追问跨轮命中 provider 缓存
          // （中段靠 context-slim 存根的确定性保持稳定）。中途提炼的记忆 /
          // 进度漂移下个会话才进 prompt；滚动摘要正是在这里被重新读入。
          await this.refreshSystemPrompt(agent, turnChapter ?? this.sessionChapter);
          const records = await this.deps.conversations.load(this.key);
          agent.state.messages = turnRecordsToMessages(
            lastTurnTail(records),
            this.resolveModel("smart"),
          );
          this.sessionStarted = true;
        }
        if (turnChapter !== undefined) this.sessionChapter = turnChapter;
      } else {
        // 全局线程无会话概念：长期存续、记忆与摘要的更新更要紧，维持每轮重建
        await this.refreshSystemPrompt(agent);
      }
      unsubscribe = agent.subscribe((event) => queue.push(event));

      const onAbort = () => agent.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });

      const userText = formatUserMessage(input);
      const startedAt = new Date().toISOString();
      let runError: unknown;
      const run = agent
        .prompt(userText)
        .then(() => agent.waitForIdle())
        .catch((error) => {
          runError = error;
        })
        .finally(() => {
          input.signal?.removeEventListener("abort", onAbort);
          queue.close();
        });

      yield { type: "status", status: "thinking" };
      // 每次模型往返的度量：turn_start 起表、首个增量记 TTFB、turn_end 报 usage
      let round = 0;
      let roundStartedAt = 0;
      let firstDeltaAt = 0;
      for await (const event of queue) {
        switch (event.type) {
          case "turn_start":
            round += 1;
            roundStartedAt = performance.now();
            firstDeltaAt = 0;
            break;
          case "turn_end": {
            const usage = (event.message as { usage?: Usage }).usage;
            const now = performance.now();
            yield {
              type: "metric",
              round,
              ttfbMs: Math.round((firstDeltaAt || now) - roundStartedAt),
              totalMs: Math.round(now - roundStartedAt),
              tokens: usage && {
                input: usage.input,
                output: usage.output,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
              },
            };
            break;
          }
          case "message_update":
            if (!firstDeltaAt) firstDeltaAt = performance.now();
            if (event.assistantMessageEvent.type === "text_delta") {
              yield { type: "text", text: event.assistantMessageEvent.delta };
            } else if (event.assistantMessageEvent.type === "thinking_delta") {
              yield { type: "thinking", text: event.assistantMessageEvent.delta };
            }
            break;
          case "tool_execution_start":
            yield {
              type: "tool-step",
              phase: "start",
              id: event.toolCallId,
              tool: event.toolName,
              args: event.args,
            };
            break;
          case "tool_execution_end":
            yield {
              type: "tool-step",
              phase: "end",
              id: event.toolCallId,
              tool: event.toolName,
              isError: event.isError,
            };
            break;
          default:
            break;
        }
      }
      await run;
      if (runError) throw runError;
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);

      await this.deps.conversations.append(this.key, {
        role: "user",
        content: userText,
        createdAt: startedAt,
      });
      const answer = lastAssistantText(agent.state.messages);
      if (answer) {
        await this.deps.conversations.append(this.key, {
          role: "assistant",
          content: answer,
          createdAt: new Date().toISOString(),
        });
      }

      // ask-note：书线程每个提问留痕（doc §7）；选区锚优先，退而锚当前阅读位置
      if (this.scope.kind === "book") {
        const firstAttachment = input.attachments?.[0];
        await this.deps.annotations.recordAsk({
          bookId: this.scope.bookId,
          question: input.text,
          anchor: firstAttachment?.anchor ?? input.positionAnchor,
          chapter: firstAttachment?.chapter,
        });
      }

      // 轮后管道：记忆提炼 + 滚动摘要。异步、不阻塞、失败静默（doc §10 第 6 步）
      this.scheduleBackgroundPipeline(input.text, answer);
      turnCompleted = true;
    } finally {
      if (this.scope.kind === "book" && !turnCompleted) this.sessionStarted = false;
      unsubscribe?.();
      this.busy = false;
    }
  }

  private scheduleBackgroundPipeline(userText: string, assistantText: string): void {
    if (!assistantText) return;
    const fast = () => this.resolveModel("fast");
    this.backgroundWork = this.backgroundWork
      .then(async () => {
        const existing = await this.deps.memory.searchMemories({
          scopes: visibleScopes(this.scope),
          limit: 20,
        });
        const result = await extractMemories({
          complete: this.completeFn,
          model: fast(),
          scope: this.scope,
          userText,
          assistantText,
          existing,
        });
        for (const candidate of result.newMemories) {
          await this.deps.memory.saveMemory({
            ...candidate,
            origin: "extraction",
            sourceThreadKey: this.key,
          });
        }
        for (const id of result.reinforcedIds) {
          await this.deps.memory.reinforceMemory(id);
        }

        const previous = await this.deps.conversations.getInsights(this.key);
        const summary = await updateRollingSummary({
          complete: this.completeFn,
          model: fast(),
          previous,
          userText,
          assistantText,
        });
        if (summary && summary !== previous) {
          await this.deps.conversations.putInsights(this.key, summary);
        }
      })
      .catch(() => {
        // 轮后管道失败绝不影响对话；巩固管道之后会有自己的重试语义
      });
  }
}
