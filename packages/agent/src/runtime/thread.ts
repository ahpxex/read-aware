/**
 * 一个线程 = 一个 pi Agent 实例（doc §5 runtime/）。
 * 职责：从 ConversationPort 水化转录、装配 system prompt（书线程每个章节
 * 会话一次、策略变化时刷新；全局线程每轮重建）、把 pi 的事件流翻译成
 * ThreadChunk、轮末持久化两条 TurnRecord（doc §10）。
 * 书线程按**章节会话**装配上下文：同章节连续，换章节发新消息才重置（doc §5）。
 */
import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import {
  AppError,
  errorCode,
  ERR_AI_MEMORY_DISABLED,
  ERR_AI_PROVIDER,
  profileContextText,
  type Id,
  type ProfileContext,
} from "@read-aware/core";
import { runMemoryBuild } from "../memory/build-policy";
import { buildSystemPrompt } from "../context/system-prompt";
import { extractMemories, extractMemoriesFromTranscript } from "../memory/extraction";
import { digestBookTick, ensureBookClassification } from "../memory/graph-upkeep";
import { chapterMemoryPolicy, needsSpoilerProtection } from "../memory/book-memory-policy";
import { bootstrapSummaryFromHistory, formatTurnsForFolding, updateRollingSummary } from "../memory/rolling-summary";
import type { CompleteFn, StreamFn } from "../models/complete";
import { classifyModelFailure } from "../models/failure";
import { READAWARE_IDENTITY } from "../models/identity";
import type { ResolveModel } from "../models/roles";
import type { BookOverview, RuntimeDeps, TurnAttachment, TurnImage } from "../ports";
import { prepareImageInputs } from "./image-input";
import { findChapterByHref } from "../text/chapter-lookup";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { visibleScopes } from "../tools/memory-tools";
import { referenceFromToolDetails } from "../tools/present-tools";
import { buildModelTools, createAgentTurnState } from "../tools/registry";
import { interactionFromToolDetails } from "../tools/user-interaction";
import { AsyncQueue } from "./async-queue";
import { elideStaleToolResults, releaseToolImages } from "./context-slim";
import { formatUserTurn, historyBeforeTurn, lastAssistantText, lastTurnTail, turnRecordsToMessages } from "./history";
import { resolveReadingPosition, type ChapterRange, type TurnReadingPosition } from "./reading-position";
import { renderExtensionContext } from "./extension-context";
import { persistExtensionMemory } from "./extension-memory";
import { formatPromptTurn, type ReadingCursor } from "./reading-cursor";
import { toolResultText } from "./tool-trace";
import { windowByTurns } from "./windowing";
import { hasConversation, withConversation, withSystemPrompt } from "./transcript";
import {
  readingContextCall,
  permittedReadingCursor,
  permittedTurnRecords,
  type ReadingContextCall,
  type ReadingContextPermissions,
} from "./reading-context-policy";

/**
 * A selection as the host sends it. `position` is for callers that already
 * hold chapter offsets; hosts send `anchor` and the runtime resolves it.
 */
export type SelectionAttachment = TurnAttachment & { position?: ChapterRange };

export interface SendTurnInput {
  text: string;
  attachments?: SelectionAttachment[];
  images?: TurnImage[];
  /** Recent conversation images for visual follow-ups; current attachments win. */
  contextImages?: TurnImage[];
  /**
   * 发送时刻的阅读游标：既是章节会话边界，也是每轮动态的当前可见上下文。
   * 它不进稳定 system prompt，所以同章翻页不会使前缀缓存失效。
   */
  readingCursor?: ReadingCursor;
  signal?: AbortSignal;
  /**
   * 丢弃线程内存态（pi Agent 实例与章节会话），本轮从持久转录重建。
   * UI 的 regenerate 在截断并持久化转录之后带上它。
   */
  reset?: boolean;
  /** Retry a failed model step in this runtime, keeping completed tool results. */
  retry?: boolean;
  /** Host user-message identity; prevents resuming a different identical question. */
  turnId?: string;
}

interface RetryCheckpoint {
  inputKey: string;
  messages: AgentMessage[];
  chunks: ThreadChunk[];
  runMessageStart: number;
  startedAt: string;
  sawReference: boolean;
  sawInteraction: boolean;
  policyKey?: string;
}

const retryInputKey = (input: SendTurnInput) =>
  JSON.stringify([input.turnId, input.text, input.attachments, input.images, input.contextImages, input.readingCursor]);

export interface AgentThreadOptions {
  scope: ThreadScope;
  deps: RuntimeDeps;
  resolveModel: ResolveModel;
  getApiKey: (provider: string) => string | undefined;
  /** 后台管道（记忆提炼）的补全调用，跑在 fast 档位上 */
  completeFn: CompleteFn;
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
 * 只剥默认以 emoji 呈现的字符、区域指示符(旗帜)、VS16 与键帽组合符：© ® ™
 * ↔ ▶ ✔ 这类默认按文字显示的符号是书目正文与引文里的正常字符，必须保留
 * (带 VS16 时只去掉 VS16，退回文字形态)。刻意不动 ZWJ —— 阿拉伯语/印地语
 * 等书目正文合法依赖它,剥了会损坏引文。
 */
const EMOJI_PATTERN = /[\p{Emoji_Presentation}\p{Regional_Indicator}\uFE0F\u20E3]/gu;
function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, "");
}

/**
 * The emoji ban over a stream. A delta can end between the two halves of a
 * surrogate pair, and neither half matches on its own, so a trailing high
 * surrogate waits for the next delta.
 */
class EmojiFilter {
  private pending = "";
  push(delta: string): string {
    const text = this.pending + delta;
    const split = /[\uD800-\uDBFF]$/.test(text);
    this.pending = split ? text.slice(-1) : "";
    return stripEmoji(split ? text.slice(0, -1) : text);
  }
  flush(): string {
    const rest = this.pending;
    this.pending = "";
    return stripEmoji(rest);
  }
}

export class AgentThread {
  readonly scope: ThreadScope;
  readonly key: string;

  private readonly deps: RuntimeDeps;
  private readonly resolveModel: ResolveModel;
  private readonly getApiKey: (provider: string) => string | undefined;
  private readonly completeFn: CompleteFn;
  private readonly streamFn: StreamFn;
  private readonly thinkingLevel: ThinkingLevel;
  private readonly maxWindowTurns: number;
  private readonly transformSystemPrompt?: (prompt: string, scope: ThreadScope) => string;

  private agent: Agent | undefined;
  /** Ephemeral, cleared on new turns, model/context invalidation or disposal. */
  private retryCheckpoint?: RetryCheckpoint;
  private checkpointModel?: (messages: AgentMessage[]) => void;
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
  /** The book classification running for this thread, if any. */
  private classification?: Promise<void>;
  /**
   * 书线程的章节会话（doc §5）：会话内 agent.state 连续累积（含工具调用的
   * 完整上下文树）；仅当用户在**另一个章节**发出新消息时才重置回无状态基线。
   * 纯内存 —— 运行时重建/重启后自然回落到基线装配。
   */
  private sessionStarted = false;
  private sessionChapter: string | undefined;
  private sessionMemoryPolicy: string | undefined;
  private contextPermissionsKey: string | undefined;
  /** 一轮内的工具侧状态（出卡去重 + 剧透围栏）；每轮 sendTurn 开始时重算。 */
  private readonly turnState = createAgentTurnState();

  constructor(options: AgentThreadOptions) {
    this.scope = options.scope;
    this.key = threadScopeKey(options.scope);
    this.deps = options.deps;
    this.resolveModel = options.resolveModel;
    this.getApiKey = options.getApiKey;
    const rawComplete = options.completeFn;
    this.completeFn = (model, context, callOptions) =>
      rawComplete(model, context, { signal: this.lifecycle.signal, ...callOptions });
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
   * Explicit context invalidation discards the cached chapter session. Tool-only
   * changes do not need this: definitions refresh at every model request.
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
    this.retryCheckpoint = undefined;
    // Tools discovered in this thread stay loaded (bounded by the registry's LRU)
    // until its agent is discarded, so a follow-up does not rediscover them.
    this.turnState.loadedTools?.clear();
    this.agent = undefined;
    this.sessionStarted = false;
    this.sessionChapter = undefined;
    this.sessionMemoryPolicy = undefined;
  }

  /**
   * 首次使用时创建 Agent。全局线程从转录 store 水化历史（线程内连续）；
   * 书线程不水化 —— 章节会话首轮由 sendTurn 重置为"一轮尾巴"基线。
   * 水化只取本轮之前的历史（宿主可能已落库本轮用户消息）。
   */
  private async ensureAgent(call: ReadingContextCall, turnId?: string): Promise<Agent> {
    if (this.agent) {
      // Apply refreshed metadata only between turns; never replace the user's model ID.
      this.agent.state.model = this.resolveModel("smart");
      return this.agent;
    }
    const model = this.resolveModel("smart");
    const records =
      this.scope.kind === "book" ? [] : historyBeforeTurn(await this.deps.conversations.load(this.key), turnId);
    call.assertAllowed();
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: this.thinkingLevel,
        tools: [],
        messages: turnRecordsToMessages(permittedTurnRecords(records, call.permissions), model),
      },
      // pi's Agent attributes requests to pi by default; they are ReadAware's.
      identity: READAWARE_IDENTITY,
      transformContext: async (messages) => {
        const context = elideStaleToolResults(windowByTurns(messages, this.maxWindowTurns));
        // Also applies to a retry checkpoint captured with a different model.
        return this.turnState.modelSupportsImages
          ? context
          : releaseToolImages(
              context,
              "[Image pixels withheld: the current model does not support image input. Do not claim visual inspection.]",
            );
      },
      // Refresh both discovery and execution context between provider requests,
      // without discarding the conversation or its turn-scoped permissions.
      prepareNextTurnWithContext: ({ context }) => ({
        context: {
          ...context,
          tools: buildModelTools(this.scope, this.deps, this.turnState),
        },
      }),
      // Agent 不转发 cacheRetention，只能在 streamFn 这层补：一轮多次往返共享
      // 同一前缀（system prompt 轮内稳定），Anthropic 式显式缓存在这里全是净赚；
      // 不支持的 provider 由 pi 忽略。
      streamFn: (model, context, options) => {
        this.checkpointModel?.(agent.state.messages.slice());
        return this.streamFn(model, context, { ...options, cacheRetention: "short" });
      },
      getApiKey: this.getApiKey,
    });
    this.agent = agent;
    return agent;
  }

  private async refreshSystemPrompt(
    agent: Agent,
    profile: ProfileContext,
    bookContext?: { book?: BookOverview; chapter?: { index: number; title?: string } },
  ): Promise<boolean> {
    let digestsUnavailable = false;
    const [shelf, memories, conversationSummary, digests] = await Promise.all([
      this.scope.kind === "global" ? this.deps.library.listBooks() : undefined,
      this.deps.memory.searchMemories({ scopes: visibleScopes(this.scope), limit: 8 }),
      this.deps.conversations.getInsights(this.key),
      this.scope.kind === "book"
        ? this.deps.bookMemory.listDigests(this.scope.bookId).catch((error) => {
            digestsUnavailable = true;
            this.deps.log?.warn("chapter memory unavailable; omitting prompt digests", error);
            return [];
          })
        : [],
    ]);
    const systemPrompt = buildSystemPrompt(this.scope, {
      book: bookContext?.book,
      currentChapter: bookContext?.chapter,
      chapterDigests: digests,
      profile: profileContextText(profile),
      shelfSize: shelf?.length,
      memories,
      conversationSummary,
      // 全局线程首次使用且画像为空 → 访谈模式（onboarding 的对话半场，doc §9）
      onboardingInterview: this.scope.kind === "global" && !profile.curated && !hasConversation(agent.state.messages),
      web: this.deps.web?.configured("search") ?? false,
    });
    agent.state.messages = withSystemPrompt(
      agent.state.messages,
      this.transformSystemPrompt ? this.transformSystemPrompt(systemPrompt, this.scope) : systemPrompt,
    );
    return !digestsUnavailable;
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    if (this.disposed) throw new Error(`thread ${this.key} has been disposed`);
    if (this.busy) throw new Error(`thread ${this.key} is already streaming a turn`);
    const controller = new AbortController();
    const cancel = () => controller.abort(input.signal?.aborted ? input.signal.reason : this.lifecycle.signal.reason);
    input.signal?.addEventListener("abort", cancel, { once: true });
    this.lifecycle.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted || this.lifecycle.signal.aborted) cancel();
    const call = readingContextCall(this.deps.readingContextPolicy, controller.signal);
    const key = JSON.stringify(call.permissions);
    if (this.contextPermissionsKey !== key) this.discardAgent();
    this.contextPermissionsKey = key;
    try {
      const permitted: SendTurnInput = {
        ...input,
        signal: call.signal,
        attachments: call.permissions.selection ? input.attachments : undefined,
        readingCursor: permittedReadingCursor(input.readingCursor, call.permissions),
      };
      const emitted: ThreadChunk[] = [];
      for await (const chunk of this.sendPermittedTurn(permitted, input, call, emitted)) {
        call.assertAllowed();
        if (chunk.type !== "metric" && chunk.type !== "status") emitted.push(chunk);
        yield chunk;
      }
    } finally {
      call.dispose();
      input.signal?.removeEventListener("abort", cancel);
      this.lifecycle.signal.removeEventListener("abort", cancel);
    }
  }

  private async *sendPermittedTurn(
    input: SendTurnInput,
    localInput: SendTurnInput,
    call: ReadingContextCall,
    emitted: ThreadChunk[],
  ): AsyncGenerator<ThreadChunk> {
    if (this.disposed) throw new Error(`thread ${this.key} has been disposed`);
    if (this.busy) throw new Error(`thread ${this.key} is already streaming a turn`);
    this.busy = true;
    const resume =
      !input.reset && input.retry && this.retryCheckpoint?.inputKey === retryInputKey(localInput)
        ? this.retryCheckpoint
        : undefined;
    if (input.reset || (this.retryCheckpoint && !resume) || (input.retry && !resume)) this.discardAgent();
    this.retryCheckpoint = undefined;
    const queue = new AsyncQueue<AgentEvent | { type: "model-checkpoint"; messages: AgentMessage[] }>();
    let unsubscribe: (() => void) | undefined;
    // Completed turns retain their session; retryable model failures retain only
    // the request boundary before the failed response. Other interruptions rebuild.
    let turnCompleted = false;
    if (!resume) {
      this.turnState.presentedBookIds.clear();
      this.turnState.webImages?.clear();
      this.turnState.presentedWebImages?.clear();
      this.turnState.modelSupportsImages = false;
      this.turnState.modelImageCount = 0;
      this.turnState.modelImageBytes = 0;
      // A spoiler approval answers one reply; a retry of that reply keeps it.
      this.turnState.spoilersAllowed = false;
      this.turnState.spoilerAccessDeclined = false;
    }
    this.turnState.readingContextPermissions = call.permissions;
    try {
      call.assertAllowed();
      this.turnState.modelSupportsImages = this.resolveModel("smart").input?.includes("image") ?? false;
      // 游标章节坐标归一：宿主（阅读器）只带 href——抽取章节 index 由 agent 用
      // 自己的权威映射反查（与 read_chapter 同一坐标系）。eval 等直接给 index
      // 的调用方原样通过。围栏与接地装配都以归一后的游标为准。
      let cursor = input.readingCursor;
      if (this.scope.kind === "book" && cursor?.chapter !== undefined && cursor.chapterIndex === undefined) {
        // The TOC only refines the cursor; without it the chapter stays unresolved, as it was.
        const toc = await call.wait(this.deps.bookText.getToc(this.scope.bookId).catch(() => undefined));
        const chapter = toc ? findChapterByHref(toc, cursor.chapter) : undefined;
        if (chapter) {
          cursor = {
            ...cursor,
            chapterIndex: chapter.index,
            chapterTitle: cursor.chapterTitle ?? chapter.title,
          };
        }
      }
      // 阅读坐标：视口与选区解析成章内地址（见 reading-position.ts）。位置用宿主的
      // 真实采样解析——围栏不随隐私设置变宽；给模型的那份另按授权裁剪。
      let located: TurnReadingPosition = { selections: [] };
      if (this.scope.kind === "book") {
        located = await call.wait(
          resolveReadingPosition({
            bookText: this.deps.bookText,
            bookId: this.scope.bookId,
            cursor: localInput.readingCursor && { ...localInput.readingCursor, chapterIndex: cursor?.chapterIndex },
            attachments: localInput.attachments,
            signal: call.signal,
          }).catch((error): TurnReadingPosition => {
            call.assertAllowed();
            this.deps.log?.warn("reading position could not be located; continuing without coordinates", error);
            return { selections: [] };
          }),
        );
        // 定位到的章节比 href 反查更准（同一文件里可以有多章）。
        if (located.viewport && cursor) {
          cursor = {
            ...cursor,
            chapterIndex: located.viewport.chapterIndex,
            chapterTitle: located.viewport.chapterTitle ?? cursor.chapterTitle,
          };
        }
      }
      // Coordinates are a pointer to the paragraphs around the reader, so they follow the rule
      // the surrounding text itself did: disclosed only when both the selection and its context are.
      const disclosed = call.permissions.selection && call.permissions.surrounding;
      const position: TurnReadingPosition = {
        ...(disclosed && located.viewport ? { viewport: located.viewport } : {}),
        selections: disclosed ? located.selections : [],
      };
      const selection = position.selections.find((range) => range !== undefined);
      this.turnState.readingRanges = {
        ...(position.viewport
          ? {
              position: {
                chapterIndex: position.viewport.chapterIndex,
                start: position.viewport.start,
                end: position.viewport.end,
              },
            }
          : {}),
        ...(selection
          ? { selection: { chapterIndex: selection.chapterIndex, start: selection.start, end: selection.end } }
          : {}),
      };
      // 剧透围栏：叙事书 + 未读完 + 本轮游标带章节 index → 正文工具只返回读者位置之前的内容，读者在授权卡片上同意才放开（spoiler-access）
      this.turnState.spoilerFence = undefined;
      this.turnState.spoilerProtected = false;
      this.turnState.bookMemoryBoundary = undefined;
      let narrativeUnfinished = false;
      let currentBook: BookOverview | undefined;
      if (this.scope.kind === "book") {
        const book = await call.wait(this.deps.library.getBook(this.scope.bookId));
        // A book without a verdict is classified in the background and stays
        // protected until then: the reply never waits for the classifier.
        if (
          book &&
          book.status !== "finished" &&
          (book.narrativity === undefined || book.spoilerSensitive === undefined)
        )
          this.classifyInBackground(
            book.id,
            call.permissions.surrounding ? (cursor?.chapterIndex ?? 0) : 0,
            call.permissions,
          );
        currentBook = book;
        this.turnState.bookMemoryBoundary = chapterMemoryPolicy(book, cursor?.chapterIndex).boundary;
        // One verdict for the fence, the spoiler card, the prompt and the graph.
        narrativeUnfinished = !!book && needsSpoilerProtection(book);
        this.turnState.spoilerProtected = narrativeUnfinished;
        if (narrativeUnfinished && cursor?.chapterIndex !== undefined) {
          // 位置在章内（已定位，或宿主给了视口文本）→ 本章不整章开放：这一判断用宿主的
          // 真实采样，围栏不随隐私设置变宽。章内边界则只在位置对模型公开时才给——
          // 读到读者那一页为止，等于交出周边上下文和读者的确切位置；被隐私设置扣留时
          // 本章保持整章不可读。
          this.turnState.spoilerFence = {
            throughChapterIndex:
              located.viewport || localInput.readingCursor?.visibleText?.trim()
                ? cursor.chapterIndex - 1
                : cursor.chapterIndex,
            readerChapterIndex: cursor.chapterIndex,
            ...(position.viewport ? { readerChapterThrough: position.viewport.through } : {}),
          };
        }
      }
      const extensionContext = await call.wait(
        Promise.resolve(
          this.deps
            .extraContext?.({
              scope: this.scope,
              userText: input.text,
              signal: call.signal,
            })
            .then(renderExtensionContext)
            .catch((error) => {
              this.deps.log?.warn("plugin context providers failed", error);
              return undefined;
            }),
        ),
      );
      call.assertAllowed();
      const agent = await call.wait(this.ensureAgent(call, input.turnId));
      const profile = await call.wait(this.deps.profile.getProfileContext());
      // 本轮所在章节：选区的章节优先于阅读位置（问哪段话,会话就属于哪章）。
      // 仅决定对话会话；纪要的阅读边界始终来自当前游标。
      const turnChapter = localInput.attachments?.[0]?.chapter ?? cursor?.chapter;
      if (this.scope.kind === "book") {
        // 书线程章节会话（doc §5）：同章节内的轮次共享同一个上下文树
        // （agent.state 连续累积，windowByTurns 封顶）；当且仅当这条消息
        // 发自另一个章节时，才把 state 重置回无状态基线 —— 上一轮
        // user↔assistant 原文（覆盖"那第二点呢？"式的明显 follow-up）加上
        // system prompt 里的滚动摘要；普通新会话仍只带最后一轮，避免把整本书
        // 的旧对话自动灌入模型。更早的历史 agent 用
        // get_recent_turns / search_conversation 拉取。章节未知（选区与阅读位置都没带 href）
        // 不算换章。UI 的连续转录在持久层，不受影响。
        const crossedChapter =
          turnChapter !== undefined && this.sessionChapter !== undefined && turnChapter !== this.sessionChapter;
        let contentVersion: string | null = null;
        try {
          contentVersion = await call.wait(
            this.deps.bookText.getSourceVersion?.(this.scope.bookId, call.signal) ?? Promise.resolve(null),
          );
        } catch (error) {
          this.deps.log?.warn("chapter source unavailable; prompt cache must refresh", error);
          this.sessionMemoryPolicy = undefined;
        }
        const policyKey = JSON.stringify({
          contentVersion,
          profile: profileContextText(profile) ?? null,
          classification: currentBook?.narrativity ?? null,
          status: currentBook?.status ?? null,
          chapterIndex: cursor?.chapterIndex ?? null,
          policy: chapterMemoryPolicy(currentBook, cursor?.chapterIndex),
          web: this.deps.web?.configured("search") ?? false,
        });
        const newSession = !this.sessionStarted || crossedChapter;
        if (newSession || policyKey !== this.sessionMemoryPolicy) {
          // Ordinary same-chapter turns keep their stable prefix. Classification,
          // profile, status, cursor boundary or a degraded digest read invalidates that cache.
          // Selection chooses the conversation session, never the reading boundary.
          // Policy changes refresh only the prompt, preserving the conversation.
          const index = cursor?.chapterIndex;
          const loaded = await call.wait(
            this.refreshSystemPrompt(agent, profile, {
              book: currentBook,
              chapter:
                index !== undefined && Number.isSafeInteger(index) && index >= 0
                  ? { index, title: cursor?.chapterTitle }
                  : undefined,
            }),
          );
          this.sessionMemoryPolicy = loaded ? policyKey : undefined;
        }
        if (newSession) {
          const records = historyBeforeTurn(await call.wait(this.deps.conversations.load(this.key)), input.turnId);
          agent.state.messages = withConversation(
            agent.state.messages,
            turnRecordsToMessages(
              permittedTurnRecords(lastTurnTail(records, 1), call.permissions),
              this.resolveModel("smart"),
            ),
          );
          this.sessionStarted = true;
        }
        if (turnChapter !== undefined) this.sessionChapter = turnChapter;
      } else {
        // 全局线程无会话概念：长期存续、记忆与摘要的更新更要紧，维持每轮重建
        await call.wait(this.refreshSystemPrompt(agent, profile));
      }
      if (resume && resume.policyKey !== this.sessionMemoryPolicy) {
        throw new AppError("ai/context-changed", "Reading context changed since the failed step", { retryable: true });
      }
      if (resume) {
        // The checkpoint keeps its tool declarations; the prompt is the one just refreshed.
        agent.state.messages = withSystemPrompt(resume.messages, agent.state.systemPrompt);
        // Replay presentation only: completed tools and their side effects do not run again.
        for (const chunk of resume.chunks) yield chunk;
      }
      // Snapshot at the actual provider boundary, before pi appends its response.
      // The event consumer can lag; reading state there would race a fast model.
      this.checkpointModel = (messages) => queue.push({ type: "model-checkpoint", messages });
      unsubscribe = agent.subscribe((event) => queue.push(event));

      const onAbort = () => agent.abort();
      call.assertAllowed();
      // The loop preparation hook runs only after the first model response.
      // Build before attaching the abort listener, so a failed discovery cannot leak it.
      agent.state.tools = buildModelTools(this.scope, this.deps, this.turnState);

      const userText = formatUserTurn(input.text, input.attachments);
      const basePromptText = formatPromptTurn(input.text, input.attachments, cursor, position);
      const withheldNote =
        localInput.attachments?.length && !call.permissions.selection
          ? "[host note: The selected passage is withheld by the reader's privacy settings. Do not guess its wording or automatically reconstruct that selection with tools. Ask for a self-contained question when the request depends on the missing passage.]"
          : undefined;
      const promptText = [basePromptText, withheldNote, extensionContext].filter(Boolean).join("\n\n");
      // 宿主在流开始前就把本轮用户消息持久化（retry 的截断可见性依赖这一点）。
      // 带 turnId 时水化已按身份切掉本轮（historyBeforeTurn）；只有不标识轮次的
      // 宿主才会把它带进 state，而 prompt() 马上又注入同一条 —— 此时尾部等值的
      // user 消息属于本轮，丢弃避免问题被喂两遍。
      const tail = agent.state.messages[agent.state.messages.length - 1];
      if (
        !resume &&
        input.turnId === undefined &&
        tail &&
        "role" in tail &&
        tail.role === "user" &&
        typeof tail.content === "string" &&
        (tail.content === input.text || tail.content === userText || tail.content === promptText)
      ) {
        agent.state.messages = agent.state.messages.slice(0, -1);
      }
      const startedAt = resume?.startedAt ?? new Date().toISOString();
      const imageContent = resume
        ? []
        : await prepareImageInputs(
            [...(input.images ?? []), ...(input.contextImages ?? [])],
            this.deps,
            this.turnState,
            call.signal,
          );
      call.assertAllowed();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      let runError: unknown;
      let sawInteraction = resume?.sawInteraction ?? false;
      let sawReference = resume?.sawReference ?? false;
      const runMessageStart = resume?.runMessageStart ?? agent.state.messages.length;
      const run = (
        resume
          ? agent.continue()
          : imageContent.length
            ? agent.prompt({
                role: "user",
                timestamp: Date.now(),
                content: [
                  { type: "text", text: promptText || "Please examine the attached image(s)." },
                  ...imageContent,
                ],
              })
            : agent.prompt(promptText)
      )
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
      let checkpoint: RetryCheckpoint | undefined;
      const emojiFilter = new EmojiFilter();
      for await (const event of queue) {
        switch (event.type) {
          case "model-checkpoint":
            checkpoint = {
              inputKey: retryInputKey(localInput),
              messages: event.messages,
              chunks: emitted.slice(),
              runMessageStart,
              startedAt,
              sawInteraction,
              sawReference,
              policyKey: this.sessionMemoryPolicy,
            };
            break;
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
              const text = emojiFilter.push(event.assistantMessageEvent.delta);
              if (text) yield { type: "text", text };
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
            const interaction = interactionFromToolDetails(partialResult?.details);
            if (interaction?.phase === "request") {
              sawInteraction = true;
              yield {
                type: "interaction",
                phase: "request",
                request: interaction.request,
              };
            } else if (interaction?.phase === "response") {
              sawInteraction = true;
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
                sawInteraction = true;
                yield {
                  type: "interaction",
                  phase: "response",
                  id: interaction.id,
                  answer: interaction.answer,
                };
              }
              let reference = referenceFromToolDetails((event.result as { details?: unknown } | undefined)?.details);
              // present_books accounts at execution; extension cards join the
              // same per-turn set here, before any reference reaches the UI.
              if (reference?.kind === "books" && event.toolName !== "present_books") {
                const books = reference.books.filter((book) => {
                  if (this.turnState.presentedBookIds.has(book.bookId)) return false;
                  this.turnState.presentedBookIds.add(book.bookId);
                  return true;
                });
                reference = books.length ? { kind: "books", books } : undefined;
              }
              if (reference) {
                sawReference = true;
                yield { type: "reference", id: event.toolCallId, reference };
              }
            }
            break;
          }
          default:
            break;
        }
      }
      const heldText = emojiFilter.flush();
      if (heldText) yield { type: "text", text: heldText };
      await run;
      call.assertAllowed();
      // 结构化状态码在 pi-ai 层已折叠成文本 —— 在这里（结构最后可见处）分类出
      // 稳定错误码，UI 据此决定文案与重试可见性，而不是转发 provider 原文。
      if (runError || agent.state.errorMessage) {
        const failure = classifyModelFailure(runError ?? agent.state.errorMessage);
        // Only model failures are resumable. Abort, policy revocation, tool execution
        // interruption and later persistence failures must rebuild normally.
        if (
          failure.retryable &&
          checkpoint &&
          !input.signal?.aborted &&
          agent.state.messages.length === checkpoint.messages.length + 1
        )
          this.retryCheckpoint = checkpoint;
        throw failure;
      }

      // Read only the messages produced by this invocation. Reasoning or an
      // opaque tool trace is not a visible answer; only text and purpose-built
      // reference/interaction chunks can complete an otherwise empty turn.
      const runMessages = agent.state.messages.slice(runMessageStart);
      // The same text the reader was shown: background memory reads it too.
      const answer = stripEmoji(lastAssistantText(runMessages));
      if (!answer.trim() && !sawReference && !sawInteraction) {
        throw new AppError(ERR_AI_PROVIDER, "[ai/provider] Model returned an empty response", { retryable: true });
      }
      // The transcript is the host's to persist (ConversationPort): it saved the
      // user message before this turn and saves the streamed reply after it.

      // ask-note：书线程每个提问留痕（doc §7）；选区锚优先，退而锚当前阅读位置
      if (this.scope.kind === "book") {
        const firstAttachment = localInput.attachments?.[0];
        await this.deps.annotations.recordAsk({
          bookId: this.scope.bookId,
          question: input.text,
          anchor: firstAttachment?.anchor ?? localInput.readingCursor?.anchor,
          chapter: firstAttachment?.chapter ?? localInput.readingCursor?.chapter,
        });
      }

      // 轮后管道：记忆提炼 + 滚动摘要 + 图谱节拍。异步、不阻塞、失败静默
      // （doc §10 第 6 步）
      call.assertAllowed();
      this.scheduleBackgroundPipeline(userText, answer, call.permissions, cursor?.chapter, input.turnId);
      // The reader's spoiler approval covered this reply only. Later text its tools
      // returned stays in the chapter session (old results are trimmed, not removed),
      // so drop the session: the next message rebuilds from the transcript, which
      // holds only what the reader was shown.
      if (this.turnState.spoilersAllowed) this.discardAgent();
      turnCompleted = true;
    } finally {
      // A retry restores the saved pre-request messages, never pi's failed draft.
      // Without a verified model checkpoint, discard potentially partial execution.
      if (!turnCompleted && !this.retryCheckpoint) this.discardAgent();
      else if (turnCompleted && this.agent) this.agent.state.messages = releaseToolImages(this.agent.state.messages);
      this.checkpointModel = undefined;
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
   *
   * 历史按本轮身份切分：管道与宿主保存助手回复并发，load() 此刻可能只含
   * 本轮用户消息、也可能已含回复——按条数切会误删一条真实历史。
   */
  private async adoptLegacyThread(
    fast: () => ReturnType<ResolveModel>,
    deps: RuntimeDeps,
    complete: CompleteFn,
    permissions: ReadingContextPermissions,
    turnId: string | undefined,
  ): Promise<string | undefined> {
    const persisted = await deps.conversations.load(this.key).catch((error) => {
      // Adoption is optional continuity: a failed read skips it rather than
      // failing this turn's memory and summary pipeline.
      deps.log?.warn("legacy thread adoption could not read the transcript", error);
      return [];
    });
    const history = permittedTurnRecords(historyBeforeTurn(persisted, turnId), permissions);
    if (history.length < 2) return undefined;
    const window = history.slice(-AgentThread.ADOPTION_WINDOW_TURNS);
    const summary = await bootstrapSummaryFromHistory({
      log: deps.log,
      complete: complete,
      model: fast(),
      turns: window,
    });
    if (this.disposed) return summary;
    const snapshots = await deps.memory.snapshotMemories({
      scopes: visibleScopes(this.scope),
      limit: 20,
    });
    const existing = snapshots.map((snapshot) => snapshot.memory);
    const inherited = await extractMemoriesFromTranscript({
      log: deps.log,
      complete: complete,
      model: fast(),
      scope: this.scope,
      transcript: formatTurnsForFolding(window),
      existing,
    });
    if (this.disposed) return summary;
    for (const candidate of inherited.newMemories) {
      try {
        await deps.memory.saveMemory({ ...candidate, origin: "extraction", sourceThreadKey: this.key });
      } catch (error) {
        if (errorCode(error) !== "memory/forgotten-suppressed") throw error;
        deps.log?.warn("Previously forgotten extraction candidate suppressed");
      }
    }
    for (const id of inherited.reinforcedIds) {
      const snapshot = snapshots.find((item) => item.memory.id === id);
      if (snapshot) await deps.memory.reinforceMemory(snapshot);
    }
    return summary;
  }

  /**
   * Classify the thread's book off the reply's path. It is reading policy, not
   * memory, so the memory-build switch does not gate it; the reading-context
   * permissions captured for this turn do. One classification at a time; a
   * failed or unsure verdict is retried by a later turn.
   */
  private classifyInBackground(bookId: Id, beforeChapterIndex: number, permissions: ReadingContextPermissions): void {
    if (this.classification || this.disposed) return;
    const call = readingContextCall(this.deps.readingContextPolicy, this.lifecycle.signal, permissions);
    const work = call
      .wait(
        ensureBookClassification(
          { deps: this.deps, bookId, model: this.resolveModel("fast"), complete: this.completeFn, signal: call.signal },
          beforeChapterIndex,
        ),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          if (!this.lifecycle.signal.aborted)
            this.deps.log?.warn("background book classification failed; the book stays protected", error);
        },
      )
      .finally(() => {
        call.dispose();
        this.classification = undefined;
      });
    this.classification = work;
    const previous = this.backgroundWork;
    this.backgroundWork = Promise.all([previous, work]).then(() => undefined);
  }

  /** 每轮对话为当前书补建的纪要章数（聊哪本书，哪本书的图就优先追平）。 */
  private static readonly DIGEST_CHAPTERS_PER_TURN = 2;

  private scheduleBackgroundPipeline(
    userText: string,
    assistantText: string,
    permissions: ReadingContextPermissions,
    cursorChapterHref: string | undefined,
    // The current turn's host identity: the transcript this pipeline reads may
    // or may not hold this turn yet, so history is cut by identity, not count.
    turnId: string | undefined,
  ): void {
    if (!assistantText) return;
    const fast = () => this.resolveModel("fast");
    const previousWork = this.backgroundWork;
    const contextCall = readingContextCall(this.deps.readingContextPolicy, this.lifecycle.signal, permissions);
    // Subscribe when enqueued so an off/on cycle also revokes waiting jobs.
    this.backgroundWork = runMemoryBuild(
      this.deps,
      async (operation) => {
        await operation.guard(() => previousWork)();
        const deps = operation.protect(this.deps);
        const complete = operation.complete(this.completeFn);
        if (this.disposed) return;
        // 领养先于逐轮提炼：先继承的记忆会出现在本轮提炼的已知清单里，
        // 同一事实不会被写两遍。
        const previousInsights = await deps.conversations.getInsights(this.key);
        const bootstrapped =
          previousInsights === undefined
            ? await this.adoptLegacyThread(fast, deps, complete, permissions, turnId)
            : undefined;
        if (this.disposed) return;
        const snapshots = await deps.memory.snapshotMemories({
          scopes: visibleScopes(this.scope),
          limit: 20,
        });
        const existing = snapshots.map((snapshot) => snapshot.memory);
        const result = await extractMemories({
          log: deps.log,
          complete,
          model: fast(),
          scope: this.scope,
          userText,
          assistantText,
          existing,
        });
        if (this.disposed) return;
        for (const candidate of result.newMemories) {
          try {
            await deps.memory.saveMemory({ ...candidate, origin: "extraction", sourceThreadKey: this.key });
          } catch (error) {
            if (errorCode(error) !== "memory/forgotten-suppressed") throw error;
            deps.log?.warn("Previously forgotten extraction candidate suppressed");
          }
        }
        for (const id of result.reinforcedIds) {
          const snapshot = snapshots.find((item) => item.memory.id === id);
          if (snapshot) await deps.memory.reinforceMemory(snapshot);
        }

        const proposed = await deps
          .extraMemoryCandidates?.({
            scope: this.scope,
            userText,
            assistantText,
            signal: operation.signal,
          })
          .catch((error) => {
            deps.log?.warn("plugin memory candidate providers failed", error);
            return [];
          });
        if (!this.disposed && proposed?.length) {
          await persistExtensionMemory({
            scope: this.scope,
            candidates: proposed,
            sourceThreadKey: this.key,
            memory: this.deps.memory,
            operation,
            log: deps.log,
          });
        }

        const previous = previousInsights ?? bootstrapped;
        const summary = await updateRollingSummary({
          log: deps.log,
          complete,
          model: fast(),
          previous,
          userText,
          assistantText,
        });
        if (!this.disposed && summary && summary !== previousInsights) {
          await deps.conversations.putInsights(this.key, summary);
        }

        // 图谱节拍：书线程每轮顺手补建这本书的纪要欠账。存量用户换新
        // agent 后从第一条消息起，图随对话逐轮追平——不必等空闲维护循环
        // （它 5 分钟一拍、只照顾最近打开的书）。账已清时这里是纯读空转。
        if (!this.disposed && this.scope.kind === "book") {
          await digestBookTick({
            deps,
            complete,
            model: fast(),
            bookId: this.scope.bookId,
            throughChapterHref: cursorChapterHref,
            maxChapters: AgentThread.DIGEST_CHAPTERS_PER_TURN,
            signal: operation.signal,
          });
        }
      },
      contextCall.signal,
    )
      .catch((error: unknown) => {
        // Opting out is an expected stop, not a failed background pipeline.
        if (errorCode(error) === ERR_AI_MEMORY_DISABLED) return;
        // 轮后管道失败绝不影响对话，但必须留痕：这一轮的记忆巩固与滚动
        // 摘要没有落下。巩固管道之后会有自己的重试语义。
        this.deps.log?.warn("post-turn pipeline failed; memory/summary skipped this turn", error);
      })
      .finally(() => contextCall.dispose());
  }
}
