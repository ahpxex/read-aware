/**
 * 运行时对应用数据的全部视图 —— 依赖倒置的边界。
 * agent 包不接触任何具体存储；apps/web 将来用它的投影（IndexedDB / SQLite）
 * 实现这些端口，测试用内存假实现。方法都是异步的，为的是不限定实现形态。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  AnnotationItem,
  BookFormat,
  BookStats,
  ChapterRef as CoreChapterRef,
  CollectionSummary,
  HighlightColor,
  HighlightItem,
  HighlightStyle,
  Id,
  NoteItem,
  ReadingStatus,
  StatsOverview,
} from "@read-aware/core";
import type {
  AgentSettingChange,
  AgentSettingsQuery,
  AgentSettingsSnapshot,
  AgentSettingsUpdateResult,
} from "./settings";
import type { ThreadScope } from "./thread-scope";
import type { ChapterDigest, MemoryRecord, MemoryScope, MemoryKind, MemoryQuery } from "@read-aware/core";
export type { DigestFlavor, DigestCharacter, DigestRelation, ChapterDigest, MemoryRecord, MemoryScope, MemoryKind, MemoryStatus } from "@read-aware/core";

// 标注读模型：直接用 @read-aware/core 的 canonical 判别联合（read-models.ts）
// —— 与插件面、产品面同一套形状，漂移在类型层就报错。
export type { AnnotationItem } from "@read-aware/core";
export type AnnotationKind = AnnotationItem["kind"];

/**
 * 给模型的书目视图：BookSummary × ReadingState 的组合投影。字段与
 * canonical 读模型同名同义 —— progressPercent 0..100。
 */
export interface BookOverview {
  id: Id;
  title: string;
  author?: string;
  format?: BookFormat;
  starred?: boolean;
  collectionId?: string | null;
  /** 阅读进度 0..100（与 ReadingState.progressPercent 同义）。 */
  progressPercent?: number;
  status?: ReadingStatus;
  /**
   * 叙事性分类（剧透围栏的启用信号）：narrative 且未读完时，越过游标
   * 章节的正文工具调用被宿主硬闸。undefined = 未分类，围栏不启用。
   * 由导入/巩固管线落库；宿主适配前 eval fixture 先行。
   */
  narrativity?: "narrative" | "expository";
  addedAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
}

export interface TurnAttachment {
  /** Exact reader-selected book text. */
  text: string;
  /** CFI or another host-native location anchor. */
  anchor?: string;
  /** Chapter href captured with the selection. */
  chapter?: string;
}

export interface TurnRecord {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** User-turn context preserved separately from authored message text. */
  attachments?: TurnAttachment[];
}

export interface LibraryPort {
  listBooks(): Promise<BookOverview[]>;
  listBookRemovalCleanup(query?: import("@read-aware/core").BookRemovalCleanupQuery): Promise<import("@read-aware/core").BookRemovalCleanupPage>;
  getBook(bookId: Id): Promise<BookOverview | undefined>;
  listCollections(): Promise<CollectionSummary[]>;
  booksInCollection(collectionId: string): Promise<Id[]>;
  getBookStats(bookId: Id): Promise<BookStats | undefined>;
  getReadingTime(query?: import("@read-aware/core").ReadingTimeQuery): Promise<import("@read-aware/core").ReadingTimeSnapshot>;
  getReadingInsights(query?: import("@read-aware/core").ReadingInsightsQuery): Promise<import("@read-aware/core").ReadingInsights>;
  listBookStats(): Promise<BookStats[]>;
  getStatsOverview(): Promise<StatsOverview>;
  editBookMetadata(
    bookId: Id,
    patch: { title?: string; author?: string },
  ): Promise<void>;
  setBookStarred(bookId: Id, starred: boolean): Promise<void>;
  setBookFinished(bookId: Id, finished: boolean): Promise<void>;
  /**
   * 落库叙事性分类（空闲管线的 LLM 判定；宿主实现记 book.narrativityClassified
   * 事件）。用户可见工具永远不该直接调它——它是管线接缝，不是编辑功能。
   */
  setBookNarrativity(bookId: Id, narrativity: "narrative" | "expository"): Promise<void>;
  removeBook(bookId: Id): Promise<void>;
  removeBooks(bookIds: Id[]): Promise<import("@read-aware/core").BookRemovalReceipt>;
  retryBookRemovalCleanup(bookIds: Id[]): Promise<import("@read-aware/core").BookFileReleaseReceipt>;
  createCollection(name: string): Promise<CollectionSummary>;
  renameCollection(collectionId: string, name: string): Promise<void>;
  removeCollection(collectionId: string): Promise<void>;
  assignBooksToCollection(
    bookIds: Id[],
    collectionId: string | null,
  ): Promise<void>;
}

export interface AnnotationsPort {
  inspectAnnotation(annotationId: Id): Promise<import("@read-aware/core").AnnotationSnapshot | null>;
  applyChanges(changes: import("@read-aware/core").AnnotationMutation[], signal?: AbortSignal): Promise<import("@read-aware/core").AnnotationCommitResult>;
  pageAnnotations(input?: import("@read-aware/core").AnnotationPageQuery): Promise<import("@read-aware/core").AnnotationPage>;
  getAnnotation(annotationId: Id): Promise<AnnotationItem | null>;
  listAnnotations(filter?: {
    bookId?: Id;
    query?: string;
    kind?: AnnotationKind;
  }): Promise<AnnotationItem[]>;
  createHighlight(input: {
    bookId: Id;
    text: string;
    anchor?: string;
    chapter?: string;
    color?: HighlightColor;
    style?: HighlightStyle;
  }): Promise<HighlightItem>;
  recolorHighlight(highlightId: Id, color: HighlightColor): Promise<void>;
  createNote(input: {
    bookId: Id;
    body: string;
    quotedText?: string;
    anchor?: string;
    chapter?: string;
  }): Promise<NoteItem>;
  updateNote(noteId: Id, body: string): Promise<void>;
  /** Remove any canonical annotation kind after the caller has confirmed it. */
  removeAnnotation(annotationId: Id): Promise<void>;
  /**
   * 记录一条 ask-note（doc §7：书线程每个提问留痕；§10 第 5 步，轮末同步落）。
   * 产品实现走共享领域层的 agent-only 动词 createAsk（origin "agent"）。
   */
  recordAsk(input: {
    bookId: Id;
    question: string;
    anchor?: string;
    chapter?: string;
  }): Promise<void>;
}

export interface ReaderPort {
  getPanels(): Promise<import("@read-aware/core").ReaderPanelsSnapshot | null>;
  setPanel(panel: import("@read-aware/core").ReaderPanel, open: boolean, signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReaderPanelReceipt>;
  setControls(visible: boolean, signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingControlsReceipt>;
  configureMode(input: import("@read-aware/core").ReadingModeConfiguration, signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingModeReceipt>;
  returnToMode(signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  stepMode(direction: "next" | "previous", signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingModeStepReceipt>;
  controlPlayback(action: "start" | "stop", signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingPlaybackReceipt>;
  getSession(): Promise<import("@read-aware/core").ReadingSessionSnapshot>;
  /** Resolves only after the desktop renderer reports its actual location. */
  openBook(bookId: Id, signal?: AbortSignal): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  /** Opens the target book when needed, then navigates to the supplied locator. */
  goTo(target: import("@read-aware/core").ReadingTarget, signal?: AbortSignal): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  back(signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  forward(signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  step(direction: "next" | "previous", signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
  close(signal?: AbortSignal, guard?: import("@read-aware/core").ReadingSessionGuard): Promise<void>;
}

export interface UserInteractionOption {
  /** Stable semantic id returned to the model, distinct from the display label. */
  id: string;
  label: string;
  description?: string;
}

export type UserPermissionAction =
  "delete-book" | "delete-books" | "delete-collection" | "delete-annotation" | "manage-memory";

type UserInteractionBase = {
  /** Globally unique for the lifetime of the tool call. */
  id: string;
  threadKey: string;
};

export type UserInteractionRequest = UserInteractionBase &
  (
    | {
        kind: "question";
        question: string;
        options: UserInteractionOption[];
        /** The host renders a free-form answer alongside the supplied choices. */
        allowCustom: boolean;
      }
    | {
        kind: "permission";
        action: UserPermissionAction;
        /** Human-readable object name; the host localizes the surrounding warning. */
        subject: string;
      }
  );

export interface UserInteractionAnswer {
  /** One of the request option ids, `approve`/`decline`, or absent for custom text. */
  optionId?: string;
  text?: string;
  /** The user skipped the question or the hosting turn was cancelled. */
  cancelled?: boolean;
}

/**
 * Suspension point between a running tool and the chat UI. The implementation
 * owns only resolver lifecycle; the tool streams the request/answer payloads
 * through pi's normal tool-update events so persistence stays in the chat seam.
 */
export interface UserInteractionPort {
  request(
    request: UserInteractionRequest,
    signal?: AbortSignal,
  ): Promise<UserInteractionAnswer>;
}

export interface NewMemoryInput {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  /** extraction = 逐轮提炼；agent = remember 工具；onboarding = 冷启动种子 */
  origin: "extraction" | "plugin" | "agent" | "onboarding";
  sourceThreadKey: string;
}

/** 巩固批处理产出的变更（doc §4 第 3 步）；实现方翻译成 memory.* 事件。 */
export type MemoryChange =
  | { type: "supersede"; id: string; byId?: string }
  | { type: "forget"; id: string }
  | { type: "promote"; id: string; scope: MemoryScope }
  | { type: "decay"; id: string; importance: number };

/**
 * 记忆读写。实现方负责：初始置信度语义、检索排序
 * （importance/recency/pinned/FTS），以及翻译成 memory.* 事件。
 */
export interface MemoryPort {
  searchMemories(filter: MemoryQuery): Promise<MemoryRecord[]>;
  /** 全量 active 记忆 —— 巩固批处理的输入。 */
  listMemories(): Promise<MemoryRecord[]>;
  /** Read revisions before model work; feedback must never be rebased onto a newer row. */
  snapshotMemories(filter?: MemoryQuery): Promise<import("@read-aware/core").MemorySnapshot[]>;
  saveMemory(input: NewMemoryInput): Promise<MemoryRecord>;
  /** 提炼命中已有记忆 → 证据 +1（doc §4：反复出现才强化） */
  reinforceMemory(snapshot: import("@read-aware/core").MemorySnapshot, signal?: AbortSignal): Promise<void>;
  applyMemoryChanges(changes: MemoryChange[], snapshots: import("@read-aware/core").MemorySnapshot[], signal?: AbortSignal): Promise<void>;
}

/**
 * 线程转录的读写。key 是 threadScopeKey()（`book:<id>` | `global`）。
 * 运行时负责在每轮结束后 append 用户轮与助手轮（doc §10 第 5 步）；
 * 集成到产品时由端口实现负责翻译成 aiMessage.appended 事件。
 */
export interface ConversationPort {
  load(threadKey: string): Promise<TurnRecord[]>;
  append(threadKey: string, turn: TurnRecord): Promise<void>;
  /**
   * 历史对话原文检索（search_conversation 工具的后端；doc §6）。
   * threadKey 缺省时检索全部线程。一次接收多个查询变体（与
   * BookTextPort.searchText 同构——口语查询逐字命中率低，换词的成本
   * 不该是一个模型往返）；实现方必须走 text/search.ts 的
   * searchTurnRecords 做匹配（目标态被 FTS 替换）。
   */
  searchTurns(filter: {
    queries: string[];
    threadKey?: string;
    limit?: number;
    /** False excludes selection attachments from both matching and results. */
    includeAttachments?: boolean;
  }): Promise<Array<TurnRecord & { threadKey: string }>>;
  /** 线程的滚动摘要（conversation_insights bundle v0）；无则 undefined。 */
  getInsights(threadKey: string): Promise<string | undefined>;
  putInsights(threadKey: string, summary: string): Promise<void>;
  /** Remove the rolling summary when the owning conversation is cleared. */
  clearInsights(threadKey: string): Promise<void>;
}

/** 用户画像摘要（user_profile_context bundle 的 v0：一段文本，无则 undefined）。 */
export interface ProfilePort {
  getProfileSummary(): Promise<string | undefined>;
  /** onboarding 与渐进式画像的写入口；实现方翻译成 profile.updated 事件。 */
  putProfileSummary(summary: string): Promise<void>;
}

/**
 * canonical ChapterRef（core read-models）+ agent 运行时的 hrefs 扩展。
 * hrefs：本章覆盖的 TOC 条目 href + 各 spine section id。运行时用来把
 * 阅读位置 / 选区的 chapter href 反查到章节索引（见 text/chapter-lookup）；
 * 不进 get_toc 的工具输出 —— 对模型是纯噪音。
 */
export type ChapterRef = CoreChapterRef & { hrefs?: string[] };

export type BookTextHit = import("@read-aware/core").BookTextHit;

/**
 * 书籍正文访问（doc §11.5 抽取管道的读端）：导入时按章节抽取的纯文本。
 * 实现方决定检索方式（目标态 SQLite FTS；现状是 text/search.ts 的共享
 * 多查询扫描）；未抽取的书返回空。
 */
export interface BookTextPort {
  preparation?: {
    start(bookId: Id, options?: import("@read-aware/core").BookTextPrepareOptions): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
    get(bookId: Id, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
    list(bookId: Id): Promise<import("@read-aware/core").BookTextTaskSnapshot[]>;
    cancel(bookId: Id, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
  };
  getTextState?(bookId: Id): Promise<import("@read-aware/core").BookTextSnapshot>;
  getNavigationToc(bookId: Id, signal?: AbortSignal): Promise<import("@read-aware/core").BookNavigationToc>;
  searchLocations(input: Omit<import("@read-aware/core").BookLocationSearch, "hrefs"> & { throughChapterIndex?: number }, signal?: AbortSignal): Promise<import("@read-aware/core").BookLocationSearchPage>;
  getToc(bookId: Id): Promise<ChapterRef[]>;
  getChapterText(bookId: Id, chapterIndex: number): Promise<string | undefined>;
  /** 一次接收多个查询变体，合并去重后的命中（减少模型的换词重试往返）。 */
  searchText(filter: import("@read-aware/core").BookTextSearch, signal?: AbortSignal): Promise<BookTextHit[]>;
  /**
   * 正文可用性三态（可选；缺省视为 getToc 空即 unextracted）：
   * textless = 抽取跑完的定论——这本书没有可抽取的文字层（纯图扫描版），
   * 工具层据此对模型说真话（"这本书读不出字"），而不是让它对着永远的
   * 空目录反复重试。
   */
  getTextStatus?(bookId: Id): Promise<"ok" | "unextracted" | "textless">;
}

/**
 * Host-owned catalog of non-sensitive preferences exposed to the agent. The
 * host registry validates every path, value, and target; credentials, endpoint
 * destinations, destructive actions, and plugin lifecycle controls never
 * enter the catalog.
 */
export interface SettingsPort {
  getSettings(query?: AgentSettingsQuery): Promise<AgentSettingsSnapshot>;
  updateSettings(
    changes: AgentSettingChange[],
  ): Promise<AgentSettingsUpdateResult>;
}

/**
 * 书籍记忆读写（book_memory 投影 v1：章节纪要 + 人物名录）。
 * 实现方以 book.chapterDigested 事件为写入口径——摘要是 LLM 产物、不可
 * 确定性重算，所以记录成事件而非只写投影；listDigests 读物化表。
 */
export interface BookMemoryPort {
  listDigests(bookId: Id): Promise<ChapterDigest[]>;
  saveDigest(bookId: Id, digest: ChapterDigest): Promise<void>;
}

/** Host logging for degraded background work that cannot report through a UI. */
export interface AgentLogPort {
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export interface AgentExtensionContextBlock {
  /** Host-stamped provenance; plugin output cannot impersonate another source. */
  source: string;
  title?: string;
  content: string;
}

export interface AgentExtensionContextRequest {
  scope: ThreadScope;
  userText: string;
}

export interface ExternalMemoryCandidate {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
}

export interface ExternalMemoryCandidateRequest {
  scope: ThreadScope;
  userText: string;
  assistantText: string;
}

export interface RuntimeDeps {
  memoryManagement: {
    inspect(id: string, signal?: AbortSignal): Promise<import("@read-aware/core").MemorySnapshot | null>;
    mutate(input: import("@read-aware/core").MemoryMutation, signal?: AbortSignal): Promise<import("@read-aware/core").MemoryMutationReceipt>;
  };
  hostCommands: {
    list(signal?: AbortSignal): Promise<import("@read-aware/core").HostCommandSnapshot>;
    execute(request: import("@read-aware/core").HostCommandRequest, signal?: AbortSignal): Promise<import("@read-aware/core").HostCommandReceipt>;
  };
  readingContextPolicy?: import("./runtime/reading-context-policy").ReadingContextPolicy;
  environment: { snapshot(): Promise<import("@read-aware/core").HostEnvironmentSnapshot> };
  workspace: {
    snapshot(query?: import("@read-aware/core").WorkspaceQuery): Promise<import("@read-aware/core").WorkspaceSnapshot>;
    navigate(target: import("@read-aware/core").WorkspaceTarget, expectedRevision?: number, signal?: AbortSignal): Promise<import("@read-aware/core").WorkspaceReceipt>;
  };
  /** Live host preference; disabled blocks derived-memory work, not stored-data reads. */
  memoryPolicy?: import("./memory/build-policy").MemoryBuildPolicy;
  library: LibraryPort;
  annotations: AnnotationsPort;
  reader: ReaderPort;
  interactions: UserInteractionPort;
  conversations: ConversationPort;
  profile: ProfilePort;
  memory: MemoryPort;
  bookText: BookTextPort;
  bookMemory: BookMemoryPort;
  settings: SettingsPort;
  log?: AgentLogPort;
  /**
   * 宿主注入的额外工具（产品侧：用户插件注册的 agent 工具）。每次模型请求
   * 前重新取快照，无需 invalidateAgents。已发出的请求使用原工具定义；
   * execute 必须复核注册身份、生命周期及当前可用性，不能转交同名新实现。
   */
  extraTools?: (scope: ThreadScope) => AgentTool[];
  /** Bounded, provenance-stamped data blocks appended to the current user turn. */
  extraContext?: (
    request: AgentExtensionContextRequest,
  ) => Promise<AgentExtensionContextBlock[]>;
  /** Candidates only: AgentThread validates and writes them through MemoryPort. */
  extraMemoryCandidates?: (
    request: ExternalMemoryCandidateRequest,
  ) => Promise<ExternalMemoryCandidate[]>;
}
