/**
 * 一个线程 = 一个 pi Agent 实例（doc §5 runtime/）。
 * 职责：从 ConversationPort 水化转录、装配 system prompt（书线程每个章节
 * 会话一次、会话内冻结；全局线程每轮重建）、把 pi 的事件流翻译成
 * ThreadChunk、轮末持久化两条 TurnRecord（doc §10）。
 * 书线程按**章节会话**装配上下文：同章节连续，换章节发新消息才重置（doc §5）。
 */
import { Agent, type AgentEvent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import { buildSystemPrompt } from "../context/system-prompt";
import { extractMemories, extractMemoriesFromTranscript } from "../memory/extraction";
import { digestBookTick } from "../memory/graph-upkeep";
import {
  bootstrapSummaryFromHistory,
  formatTurnsForFolding,
  updateRollingSummary,
} from "../memory/rolling-summary";
import type { CompleteFn, StreamFn } from "../models/complete";
import { classifyModelFailure } from "../models/failure";
import type { ResolveModel } from "../models/roles";
import type { RuntimeDeps, TurnAttachment } from "../ports";
import { findChapterByHref } from "../text/chapter-lookup";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { visibleScopes } from "../tools/memory-tools";
import { referenceFromToolDetails } from "../tools/present-tools";
import { buildAgentTools, createAgentTurnState } from "../tools/registry";
import { hasExplicitSpoilerPermission } from "../tools/spoiler-permission";
import { interactionFromToolDetails } from "../tools/user-interaction";
import { AsyncQueue } from "./async-queue";
import { elideStaleToolResults } from "./context-slim";
import {
  formatUserTurn,
  lastAssistantText,
  lastTurnTail,
  turnRecordsToMessages,
} from "./history";
import { buildGroundingContext } from "./grounding-context";
import {
  normalizeExternalMemoryCandidates,
  renderExtensionContext,
} from "./extension-context";
import {
  inspectNarrativeEvidence,
  loadNarrativeBookIndex,
  normalizeEvidenceText,
  type NarrativeBookIndex,
  type NarrativeEvidenceViolation,
} from "./narrative-evidence";
import { formatPromptTurn, type ReadingCursor } from "./reading-cursor";
import { toolResultText } from "./tool-trace";
import { windowByTurns } from "./windowing";

export type SelectionAttachment = TurnAttachment;

export interface SendTurnInput {
  text: string;
  attachments?: SelectionAttachment[];
  /**
   * 发送时刻的阅读游标：既是章节会话边界，也是每轮动态的当前可见上下文。
   * 它不进稳定 system prompt，所以同章翻页不会使前缀缓存失效。
   */
  readingCursor?: ReadingCursor;
  signal?: AbortSignal;
  /**
   * 丢弃线程内存态（pi Agent 实例与章节会话），本轮从持久转录重建。
   * UI 的 retry/regenerate 在截断并持久化转录之后带上它。
   */
  reset?: boolean;
}

export interface AgentThreadOptions {
  scope: ThreadScope;
  deps: RuntimeDeps;
  resolveModel: ResolveModel;
  getApiKey: (provider: string) => string | undefined;
  /** 后台管道（记忆提炼）的补全调用，跑在 fast 档位上 */
  completeFn: CompleteFn;
  /** 剧透证据闸触发后的重写调用；生产使用 smart，测试可独立注入。 */
  repairCompleteFn?: CompleteFn;
  /** 主聊天的流式调用，使用与后台管道相同的 provider registry。 */
  streamFn: StreamFn;
  /** 聊天轮次（smart 档）的 thinking effort，默认 "off" */
  thinkingLevel?: ThinkingLevel;
  /** transformContext 窗口大小（用户轮数），默认 12 */
  maxWindowTurns?: number;
  /**
   * Stable experiment seam for comparing complete prompt configurations in
   * evals. Production callers normally leave this unset.
   */
  transformSystemPrompt?: (prompt: string, scope: ThreadScope) => string;
}

const DEFAULT_WINDOW_TURNS = 12;

/**
 * "Never use emoji" 是产品级绝对禁令（设计系统: editorial restraint）——
 * 在流层确定性执行,不赌模型自觉(低 thinking 档位实测会违禁)。
 * 只剥 emoji 图形符号、区域指示符(旗帜)与 VS16;刻意不动 ZWJ —— 阿拉伯
 * 语/印地语等书目正文合法依赖它,剥了会损坏引文。
 */
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu;
function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, "");
}

export class AgentThread {
  readonly scope: ThreadScope;
  readonly key: string;

  private readonly deps: RuntimeDeps;
  private readonly resolveModel: ResolveModel;
  private readonly getApiKey: (provider: string) => string | undefined;
  private readonly completeFn: CompleteFn;
  private readonly repairCompleteFn: CompleteFn;
  private readonly streamFn: StreamFn;
  private readonly thinkingLevel: ThinkingLevel;
  private readonly maxWindowTurns: number;
  private readonly transformSystemPrompt?: (prompt: string, scope: ThreadScope) => string;

  private agent: Agent | undefined;
  private busy = false;
  private disposed = false;
  /**
   * 线程生命周期的取消信号：dispose 时 abort，贯穿到后台管道的每次
   * completeFn 调用——否则超时/关闭后 in-flight 的提炼请求会孤儿化，
   * 挂满到 provider 的连接池（GLM 全量实测：一个超时场景的孤儿把后续
   * 套件饿了二十多分钟）。
   */
  private readonly lifecycle = new AbortController();
  private backgroundWork: Promise<void> = Promise.resolve();
  /**
   * 书线程的章节会话（doc §5）：会话内 agent.state 连续累积（含工具调用的
   * 完整上下文树）；仅当用户在**另一个章节**发出新消息时才重置回无状态基线。
   * 纯内存 —— 运行时重建/重启后自然回落到基线装配。
   */
  private sessionStarted = false;
  private sessionChapter: string | undefined;
  /** 一轮内的工具侧状态（出卡去重 + 剧透围栏）；每轮 sendTurn 开始时重算。 */
  private readonly turnState = createAgentTurnState();
  /** 未读正文只留在宿主侧作负证据索引，绝不进入模型上下文。 */
  private narrativeBookIndex?: Promise<NarrativeBookIndex>;

  constructor(options: AgentThreadOptions) {
    this.scope = options.scope;
    this.key = threadScopeKey(options.scope);
    this.deps = options.deps;
    this.resolveModel = options.resolveModel;
    this.getApiKey = options.getApiKey;
    const rawComplete = options.completeFn;
    this.completeFn = (model, context, callOptions) =>
      rawComplete(model, context, { signal: this.lifecycle.signal, ...callOptions });
    const rawRepair = options.repairCompleteFn ?? options.completeFn;
    this.repairCompleteFn = (model, context, callOptions) =>
      rawRepair(model, context, { signal: this.lifecycle.signal, ...callOptions });
    this.streamFn = options.streamFn;
    this.thinkingLevel = options.thinkingLevel ?? "off";
    this.maxWindowTurns = options.maxWindowTurns ?? DEFAULT_WINDOW_TURNS;
    this.transformSystemPrompt = options.transformSystemPrompt;
  }

  /** 等待后台管道（记忆提炼）排空 —— 测试与关闭线程时用。 */
  flushBackgroundWork(): Promise<void> {
    return this.backgroundWork;
  }

  /**
   * 工具集失效（如插件启停）：丢弃缓存的 Agent，下一轮 ensureAgent() 以
   * 最新的 extraTools 快照重建。转录在 store 里，无损。
   */
  invalidateAgent(): void {
    this.discardAgent();
  }

  /** Permanently stop this cached instance when its conversation is cleared. */
  dispose(): void {
    this.disposed = true;
    this.lifecycle.abort();
    this.agent?.abort();
    this.discardAgent();
  }

  /**
   * 丢弃 pi Agent 与章节会话标记；下一轮 ensureAgent() / 会话装配从
   * ConversationPort 重新水化。丢弃廉价：工具是重建的闭包，全局线程的
   * 重水化只是一次 conversations.load。
   */
  private discardAgent(): void {
    this.agent = undefined;
    this.sessionStarted = false;
    this.sessionChapter = undefined;
  }

  private loadNarrativeIndex(): Promise<NarrativeBookIndex> | undefined {
    if (this.scope.kind !== "book") return undefined;
    this.narrativeBookIndex ??= loadNarrativeBookIndex(
      this.deps.bookText,
      this.scope.bookId,
    );
    return this.narrativeBookIndex;
  }

  private fallbackForUnsafeAnswer(readerText: string): string {
    if (/[぀-ヿ]/u.test(readerText)) {
      return "今の読書位置を守るため、この先の内容には触れません。どこまで読んだか、またはネタバレ可だと明示してください。";
    }
    if (/[가-힯]/u.test(readerText)) {
      return "현재 읽는 위치를 지키기 위해 이후 내용은 설명하지 않겠습니다. 어디까지 읽었는지 알려 주거나 스포일러를 허용한다고 명확히 말해 주세요.";
    }
    if (/[一-鿿]/u.test(readerText)) {
      return "为了守住你当前的阅读进度，我先不展开这部分。请告诉我读到哪里，或者明确说明可以剧透。";
    }
    if (/[Ѐ-ӿ]/u.test(readerText)) {
      return "Чтобы не раскрывать непрочитанное, я пока не буду развивать эту часть. Скажите, где вы остановились, или явно разрешите спойлеры.";
    }
    return "To protect your current reading position, I will not expand on that yet. Tell me where you are, or explicitly allow spoilers.";
  }

  /** Drop whole prose blocks that carry a detected leak; coherent safe blocks survive. */
  private redactUnsafeBlocks(
    draft: string,
    violations: NarrativeEvidenceViolation[],
  ): string {
    const forbidden = violations.map((item) => normalizeEvidenceText(item.phrase));
    return draft
      .split(/\n\s*\n/u)
      .filter((block) => {
        const normalized = normalizeEvidenceText(block);
        return !forbidden.some((phrase) => normalized.includes(phrase));
      })
      .join("\n\n")
      .trim();
  }

  private async repairUnsafeAnswer(input: {
    readerText: string;
    draft: string;
    cursor?: ReadingCursor;
    attachments?: TurnAttachment[];
    violations: NarrativeEvidenceViolation[];
    book: NarrativeBookIndex;
  }): Promise<{ answer: string; usage?: Usage; elapsedMs: number }> {
    const started = performance.now();
    const forbidden = input.violations.map((item) => item.phrase);
    const safeEvidence = [
      input.cursor?.visibleText,
      ...(input.attachments?.map((attachment) => attachment.text) ?? []),
      ...this.turnState.evidenceTexts,
    ].filter((value): value is string => !!value?.trim());
    const message = await this.repairCompleteFn(
      this.resolveModel("smart"),
      {
        systemPrompt: [
          "You are a final response safety rewriter for a reading app.",
          "Return only the replacement answer, in the reader's language.",
          "Use only the reader message and the safe evidence below for book-specific claims.",
          "Remove every future-only or edition-ungrounded detail. Do not name, quote, negate, hint at, or apologize for the removed details.",
          "For a progress or TOC question, give only the requested position or structure without previews.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              readerMessage: input.readerText,
              safeEvidence,
              unsafeDraft: input.draft,
              forbiddenMaterial: forbidden,
            }),
            timestamp: Date.now(),
          },
        ],
      },
    );
    const candidate = stripEmoji(lastAssistantText([message]));
    const remaining = inspectNarrativeEvidence({
      answer: candidate,
      readerText: input.readerText,
      attachments: input.attachments,
      cursor: input.cursor,
      toolEvidence: this.turnState.evidenceTexts,
      book: input.book,
      allowFuture: this.turnState.spoilerGranted,
    });
    return {
      answer: candidate.trim() && remaining.length === 0
        ? candidate
        : this.fallbackForUnsafeAnswer(input.readerText),
      usage: message.usage,
      elapsedMs: Math.round(performance.now() - started),
    };
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
        thinkingLevel: this.thinkingLevel,
        tools: buildAgentTools(this.scope, this.deps, this.turnState),
        messages: turnRecordsToMessages(records, model),
      },
      transformContext: async (messages) =>
        elideStaleToolResults(windowByTurns(messages, this.maxWindowTurns)),
      // Agent 不转发 cacheRetention，只能在 streamFn 这层补：一轮多次往返共享
      // 同一前缀（system prompt 轮内稳定），Anthropic 式显式缓存在这里全是净赚；
      // 不支持的 provider 由 pi 忽略。
      streamFn: (model, context, options) =>
        this.streamFn(model, context, { ...options, cacheRetention: "short" }),
      getApiKey: this.getApiKey,
    });
    this.agent = agent;
    return agent;
  }

  private async refreshSystemPrompt(
    agent: Agent,
    currentChapterHref?: string,
    cursorChapterIndex?: number,
  ): Promise<void> {
    const wantsPosition =
      this.scope.kind === "book" && (!!currentChapterHref || cursorChapterIndex !== undefined);
    const [profile, book, shelf, memories, conversationSummary, toc, digests] = await Promise.all([
      this.deps.profile.getProfileSummary(),
      this.scope.kind === "book" ? this.deps.library.getBook(this.scope.bookId) : undefined,
      this.scope.kind === "global" ? this.deps.library.listBooks() : undefined,
      this.deps.memory.searchMemories({ scopes: visibleScopes(this.scope), limit: 8 }),
      this.deps.conversations.getInsights(this.key),
      // 位置反查要 hrefs，只有书线程带着章节 href 时才取目录
      wantsPosition && this.scope.kind === "book"
        ? this.deps.bookText.getToc(this.scope.bookId).catch(() => undefined)
        : undefined,
      this.scope.kind === "book"
        ? this.deps.bookMemory.listDigests(this.scope.bookId).catch(() => [])
        : [],
    ]);
    // 章节身份：href 反查优先；游标直给的 index（eval、以及 href 缺失的
    // 宿主）作回退——两者同源于 getToc 的坐标系。
    const chapter =
      (toc && currentChapterHref ? findChapterByHref(toc, currentChapterHref) : undefined) ??
      (toc && cursorChapterIndex !== undefined ? toc[cursorChapterIndex] : undefined);
    // 章节纪要按剧透边界过滤：叙事未读完只给当前章之前的；位置不明时
    // 宁缺毋滥（一条都不给）。说明书/已读完不设边界。
    const fenced = book?.narrativity === "narrative" && book.status !== "finished";
    const chapterDigests =
      this.scope.kind !== "book"
        ? undefined
        : fenced
          ? chapter
            ? digests.filter((digest) => digest.chapterIndex < chapter.index)
            : []
          : digests;
    const systemPrompt = buildSystemPrompt(this.scope, {
      book,
      currentChapter: chapter && { index: chapter.index, title: chapter.title },
      chapterDigests,
      profile,
      shelfSize: shelf?.length,
      memories,
      conversationSummary,
      // 全局线程首次使用且画像为空 → 访谈模式（onboarding 的对话半场，doc §9）
      onboardingInterview:
        this.scope.kind === "global" && !profile && agent.state.messages.length === 0,
    });
    agent.state.systemPrompt = this.transformSystemPrompt
      ? this.transformSystemPrompt(systemPrompt, this.scope)
      : systemPrompt;
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    if (this.disposed) throw new Error(`thread ${this.key} has been disposed`);
    if (this.busy) throw new Error(`thread ${this.key} is already streaming a turn`);
    this.busy = true;
    // retry/regenerate：UI 已截断并持久化转录，丢内存态从持久层重建本轮
    if (input.reset) this.discardAgent();
    const queue = new AsyncQueue<AgentEvent>();
    let unsubscribe: (() => void) | undefined;
    // 只有干净收尾的轮次才留在章节会话里；中断/报错后 agent.state 形状
    // 不可信，下一轮从持久记录重建基线（等价于今天的无状态装配）。
    let turnCompleted = false;
    this.turnState.presentedBookIds.clear();
    this.turnState.spoilerPermissionGranted = hasExplicitSpoilerPermission(input.text);
    this.turnState.spoilerPermissionDenied = false;
    this.turnState.spoilerGranted = false;
    this.turnState.evidenceTexts.length = 0;
    // 游标章节坐标归一：宿主（阅读器）只带 href——抽取章节 index 由 agent 用
    // 自己的权威映射反查（与 read_chapter 同一坐标系）。eval 等直接给 index
    // 的调用方原样通过。围栏与接地装配都以归一后的游标为准。
    let cursor = input.readingCursor;
    if (
      this.scope.kind === "book" &&
      cursor?.chapter !== undefined &&
      cursor.chapterIndex === undefined
    ) {
      const toc = await this.deps.bookText.getToc(this.scope.bookId).catch(() => undefined);
      const chapter = toc ? findChapterByHref(toc, cursor.chapter) : undefined;
      if (chapter) {
        cursor = {
          ...cursor,
          chapterIndex: chapter.index,
          chapterTitle: cursor.chapterTitle ?? chapter.title,
        };
      }
    }
    // 剧透围栏：叙事书 + 未读完 + 本轮游标带章节 index → 正文工具越界需 confirmSpoiler
    this.turnState.spoilerFence = undefined;
    let narrativeUnfinished = false;
    if (this.scope.kind === "book") {
      const book = await this.deps.library.getBook(this.scope.bookId);
      narrativeUnfinished = book?.narrativity === "narrative" && book.status !== "finished";
      if (narrativeUnfinished && cursor?.chapterIndex !== undefined) {
        this.turnState.spoilerFence = {
          throughChapterIndex: cursor.visibleText?.trim()
            ? cursor.chapterIndex - 1
            : cursor.chapterIndex,
          readerChapterIndex: cursor.chapterIndex,
        };
      }
    }
    // 与远端推理并行预热；未读正文不会进入 prompt，只在回包前作负证据比对。
    const narrativeIndexPromise = narrativeUnfinished ? this.loadNarrativeIndex() : undefined;
    // 选中提问的确定性接地：边界内原文证据随本轮注入（见 grounding-context.ts）。
    // 装配失败静默降级；叙事书没有章节坐标时宁缺毋滥。
    const groundingContext =
      this.scope.kind === "book" && input.attachments?.length
        ? await buildGroundingContext({
            bookText: this.deps.bookText,
            bookId: this.scope.bookId,
            attachments: input.attachments,
            cursor,
            narrativeFence: narrativeUnfinished,
          })
        : undefined;
    const extensionContext = await this.deps.extraContext?.({
      scope: this.scope,
      userText: input.text,
    }).then(renderExtensionContext).catch((error) => {
      this.deps.log?.warn("plugin context providers failed", error);
      return undefined;
    });
    try {
      const agent = await this.ensureAgent();
      // 本轮所在章节：选区的章节优先于阅读位置（问哪段话,会话就属于哪章）。
      // 双重职责：章节会话的边界信号 + system prompt 的稳定章节身份。
      const turnChapter = input.attachments?.[0]?.chapter ?? cursor?.chapter;
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
          // system prompt 只在会话开始装配一次（含章节身份快照），会话内
          // 冻结 —— 前缀头部字节级稳定，同章追问跨轮命中 provider 缓存
          // （中段靠 context-slim 存根的确定性保持稳定）。中途提炼的记忆 /
          // 动态章内游标只进最新 user message；滚动摘要正是在这里重读。
          await this.refreshSystemPrompt(
            agent,
            turnChapter ?? this.sessionChapter,
            cursor?.chapterIndex,
          );
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

      const userText = formatUserTurn(input.text, input.attachments);
      const basePromptText = formatPromptTurn(
        input.text,
        input.attachments,
        cursor,
        groundingContext,
      );
      const promptText = extensionContext
        ? `${basePromptText}\n\n${extensionContext}`
        : basePromptText;
      // UI 在流开始前就把本轮用户消息持久化（retry 的截断可见性依赖这一点）。
      // 全局线程水化 / 未来任何全量重建会把它带进 state，而 prompt() 马上又
      // 注入同一条 —— 尾部等值的 user 消息属于本轮，丢弃避免问题被喂两遍。
      const tail = agent.state.messages[agent.state.messages.length - 1];
      if (
        tail &&
        "role" in tail &&
        tail.role === "user" &&
        typeof tail.content === "string" &&
        (tail.content === input.text || tail.content === userText || tail.content === promptText)
      ) {
        agent.state.messages = agent.state.messages.slice(0, -1);
      }
      const startedAt = new Date().toISOString();
      let runError: unknown;
      const run = agent
        .prompt(promptText)
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
      let bufferedText = "";
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
              costUsd: usage?.cost.total,
            };
            break;
          }
          case "message_update":
            if (!firstDeltaAt) firstDeltaAt = performance.now();
            if (event.assistantMessageEvent.type === "text_delta") {
              const delta = stripEmoji(event.assistantMessageEvent.delta);
              if (narrativeUnfinished) bufferedText += delta;
              else yield { type: "text", text: delta };
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
          case "tool_execution_update": {
            const partialResult = event.partialResult;
            const partialOutput = partialResult ? toolResultText(partialResult) : undefined;
            if (partialOutput) {
              yield {
                type: "tool-step",
                phase: "update",
                id: event.toolCallId,
                tool: event.toolName,
                output: partialOutput,
              };
            }
            const interaction = interactionFromToolDetails(
              partialResult?.details,
            );
            if (interaction?.phase === "request") {
              yield {
                type: "interaction",
                phase: "request",
                request: interaction.request,
              };
            } else if (interaction?.phase === "response") {
              yield {
                type: "interaction",
                phase: "response",
                id: interaction.id,
                answer: interaction.answer,
              };
            }
            break;
          }
          case "tool_execution_end": {
            yield {
              type: "tool-step",
              phase: "end",
              id: event.toolCallId,
              tool: event.toolName,
              isError: event.isError,
              output: toolResultText(event.result),
            };
            // 展示类工具（present_* / lookup_word）把卡片 payload 放在
            // AgentToolResult.details 里 —— 这里转成 reference chunk 流给 UI
            if (!event.isError) {
              const interaction = interactionFromToolDetails(
                (event.result as { details?: unknown } | undefined)?.details,
              );
              if (interaction?.phase === "response") {
                yield {
                  type: "interaction",
                  phase: "response",
                  id: interaction.id,
                  answer: interaction.answer,
                };
              }
              const reference = referenceFromToolDetails(
                (event.result as { details?: unknown } | undefined)?.details,
              );
              if (reference) {
                yield { type: "reference", id: event.toolCallId, reference };
              }
            }
            break;
          }
          default:
            break;
        }
      }
      await run;
      // 结构化状态码在 pi-ai 层已折叠成文本 —— 在这里（结构最后可见处）分类出
      // 稳定错误码，UI 据此决定文案与重试可见性，而不是转发 provider 原文。
      if (runError) throw classifyModelFailure(runError);
      if (agent.state.errorMessage) throw classifyModelFailure(agent.state.errorMessage);

      let answer = lastAssistantText(agent.state.messages);
      let discardUnsafeAgent = false;
      if (narrativeUnfinished) {
        const visibleDraft = bufferedText || stripEmoji(answer);
        if (this.turnState.spoilerPermissionDenied && !this.turnState.spoilerGranted) {
          answer = this.fallbackForUnsafeAnswer(input.text);
          discardUnsafeAgent = true;
          this.deps.log?.warn(
            "narrative answer replaced after an unauthorized spoiler-tool attempt",
          );
          yield { type: "text", text: answer };
        } else {
          const bookIndex = await narrativeIndexPromise?.catch((error) => {
            this.deps.log?.warn("narrative evidence index failed to load", error);
            return undefined;
          });
          const violations = bookIndex
            ? inspectNarrativeEvidence({
                answer: visibleDraft,
                readerText: input.text,
                attachments: input.attachments,
                cursor,
                toolEvidence: this.turnState.evidenceTexts,
                book: bookIndex,
                allowFuture: this.turnState.spoilerGranted,
              })
            : [];
          if (violations.length > 0 && bookIndex) {
            const redacted = this.redactUnsafeBlocks(visibleDraft, violations);
            const redactedViolations = redacted
              ? inspectNarrativeEvidence({
                  answer: redacted,
                  readerText: input.text,
                  attachments: input.attachments,
                  cursor,
                  toolEvidence: this.turnState.evidenceTexts,
                  book: bookIndex,
                  allowFuture: this.turnState.spoilerGranted,
                })
              : violations;
            const repaired =
              redacted.length >= 20 && redactedViolations.length === 0
                ? { answer: redacted, usage: undefined, elapsedMs: 0 }
                : await this.repairUnsafeAnswer({
                    readerText: input.text,
                    draft: visibleDraft,
                    cursor,
                    attachments: input.attachments,
                    violations,
                    book: bookIndex,
                  }).catch((error) => {
                    this.deps.log?.warn(
                      "narrative answer rewrite failed; using deterministic fallback",
                      error,
                    );
                    return {
                      answer: this.fallbackForUnsafeAnswer(input.text),
                      usage: undefined,
                      elapsedMs: 0,
                    };
                  });
            answer = repaired.answer;
            discardUnsafeAgent = true;
            this.deps.log?.warn("narrative answer replaced at evidence boundary", violations);
            if (repaired.elapsedMs > 0 || repaired.usage) {
              yield {
                type: "metric",
                round: round + 1,
                ttfbMs: repaired.elapsedMs,
                totalMs: repaired.elapsedMs,
                tokens: repaired.usage && {
                  input: repaired.usage.input,
                  output: repaired.usage.output,
                  cacheRead: repaired.usage.cacheRead,
                  cacheWrite: repaired.usage.cacheWrite,
                },
                costUsd: repaired.usage?.cost.total,
              };
            }
            yield { type: "text", text: answer };
          } else if (visibleDraft) {
            yield { type: "text", text: visibleDraft };
          }
        }
      }

      await this.deps.conversations.append(this.key, {
        role: "user",
        content: input.text,
        createdAt: startedAt,
        attachments: input.attachments,
      });
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
          anchor: firstAttachment?.anchor ?? input.readingCursor?.anchor,
          chapter: firstAttachment?.chapter ?? input.readingCursor?.chapter,
        });
      }

      // 轮后管道：记忆提炼 + 滚动摘要 + 图谱节拍。异步、不阻塞、失败静默
      // （doc §10 第 6 步）
      this.scheduleBackgroundPipeline(userText, answer, cursor?.chapter);
      if (discardUnsafeAgent) this.discardAgent();
      turnCompleted = true;
    } finally {
      // 中断/报错后 agent.state 不可信 —— pi 会把 stopReason=error/aborted 的
      // 助手消息连同本轮用户消息留在 state.messages 里。两种线程都整体丢弃，
      // 下一轮从持久转录重建（书线程回到会话基线，全局线程 ensureAgent 重水化）。
      if (!turnCompleted) this.discardAgent();
      unsubscribe?.();
      this.busy = false;
    }
  }

  /** 旧线程领养的历史窗口：折叠成 bootstrap 摘要 + 跑一次继承提炼的轮数上限。 */
  private static readonly ADOPTION_WINDOW_TURNS = 24;

  /**
   * 旧线程领养（存量用户的继承半场）：这条线程在摘要/记忆管线上线之前就
   * 积累了转录（有历史、无 insights 行）——把历史尾部折叠成初始滚动摘要，
   * 并对同一窗口跑一次保守记忆提炼（提炼自身对已知记忆去重/强化）。
   * insights 落库后门条件永不再成立——它就是领养的水位线。更早的历史
   * 不强行蒸馏：转录是 raw source，按需靠 search_conversation 取。
   * 返回 bootstrap 摘要（作本轮滚动摘要的 previous）；失败返回 undefined，
   * 本轮按无摘要继续、下轮门条件仍在，自动重试。
   */
  private async adoptLegacyThread(
    fast: () => ReturnType<ResolveModel>,
  ): Promise<string | undefined> {
    const persisted = await this.deps.conversations.load(this.key).catch(() => []);
    // load() 此刻已含本轮 user+assistant 两条；历史 = 之前的部分。
    const history = persisted.slice(0, Math.max(0, persisted.length - 2));
    if (history.length < 2) return undefined;
    const window = history.slice(-AgentThread.ADOPTION_WINDOW_TURNS);
    const summary = await bootstrapSummaryFromHistory({
      log: this.deps.log,
      complete: this.completeFn,
      model: fast(),
      turns: window,
    });
    if (this.disposed) return summary;
    const existing = await this.deps.memory.searchMemories({
      scopes: visibleScopes(this.scope),
      limit: 20,
    });
    const inherited = await extractMemoriesFromTranscript({
      log: this.deps.log,
      complete: this.completeFn,
      model: fast(),
      scope: this.scope,
      transcript: formatTurnsForFolding(window),
      existing,
    });
    if (this.disposed) return summary;
    for (const candidate of inherited.newMemories) {
      await this.deps.memory.saveMemory({
        ...candidate,
        origin: "extraction",
        sourceThreadKey: this.key,
      });
    }
    for (const id of inherited.reinforcedIds) {
      await this.deps.memory.reinforceMemory(id);
    }
    return summary;
  }

  /** 每轮对话为当前书补建的纪要章数（聊哪本书，哪本书的图就优先追平）。 */
  private static readonly DIGEST_CHAPTERS_PER_TURN = 2;

  private scheduleBackgroundPipeline(
    userText: string,
    assistantText: string,
    cursorChapterHref?: string,
  ): void {
    if (!assistantText) return;
    const fast = () => this.resolveModel("fast");
    this.backgroundWork = this.backgroundWork
      .then(async () => {
        if (this.disposed) return;
        // 领养先于逐轮提炼：先继承的记忆会出现在本轮提炼的已知清单里，
        // 同一事实不会被写两遍。
        const previousInsights = await this.deps.conversations.getInsights(this.key);
        const bootstrapped =
          previousInsights === undefined ? await this.adoptLegacyThread(fast) : undefined;
        if (this.disposed) return;
        const existing = await this.deps.memory.searchMemories({
          scopes: visibleScopes(this.scope),
          limit: 20,
        });
        const result = await extractMemories({
          log: this.deps.log,
          complete: this.completeFn,
          model: fast(),
          scope: this.scope,
          userText,
          assistantText,
          existing,
        });
        if (this.disposed) return;
        const knownForExtensions = [...existing];
        for (const candidate of result.newMemories) {
          const saved = await this.deps.memory.saveMemory({
            ...candidate,
            origin: "extraction",
            sourceThreadKey: this.key,
          });
          knownForExtensions.push(saved);
        }
        for (const id of result.reinforcedIds) {
          await this.deps.memory.reinforceMemory(id);
        }

        const proposed = await this.deps.extraMemoryCandidates?.({
          scope: this.scope,
          userText,
          assistantText,
        }).catch((error) => {
          this.deps.log?.warn("plugin memory candidate providers failed", error);
          return [];
        });
        if (!this.disposed && proposed?.length) {
          const candidates = normalizeExternalMemoryCandidates({
            scope: this.scope,
            candidates: proposed,
            existing: knownForExtensions,
          });
          for (const candidate of candidates) {
            const saved = await this.deps.memory.saveMemory({
              ...candidate,
              origin: "plugin",
              sourceThreadKey: this.key,
            });
            knownForExtensions.push(saved);
          }
        }

        const previous = previousInsights ?? bootstrapped;
        const summary = await updateRollingSummary({
          log: this.deps.log,
          complete: this.completeFn,
          model: fast(),
          previous,
          userText,
          assistantText,
        });
        if (!this.disposed && summary && summary !== previousInsights) {
          await this.deps.conversations.putInsights(this.key, summary);
        }

        // 图谱节拍：书线程每轮顺手补建这本书的纪要欠账。存量用户换新
        // agent 后从第一条消息起，图随对话逐轮追平——不必等空闲维护循环
        // （它 5 分钟一拍、只照顾最近打开的书）。账已清时这里是纯读空转。
        if (!this.disposed && this.scope.kind === "book") {
          await digestBookTick({
            deps: this.deps,
            complete: this.completeFn,
            model: fast(),
            bookId: this.scope.bookId,
            throughChapterHref: cursorChapterHref,
            maxChapters: AgentThread.DIGEST_CHAPTERS_PER_TURN,
          });
        }
      })
      .catch((error: unknown) => {
        // 轮后管道失败绝不影响对话，但必须留痕：这一轮的记忆巩固与滚动
        // 摘要没有落下。巩固管道之后会有自己的重试语义。
        this.deps.log?.warn("post-turn pipeline failed; memory/summary skipped this turn", error);
      });
  }
}
