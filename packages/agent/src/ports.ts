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
  getBook(bookId: Id): Promise<BookOverview | undefined>;
  listCollections(): Promise<CollectionSummary[]>;
  booksInCollection(collectionId: string): Promise<Id[]>;
  getBookStats(bookId: Id): Promise<BookStats | undefined>;
  listBookStats(): Promise<BookStats[]>;
  getStatsOverview(): Promise<StatsOverview>;
  editBookMetadata(
    bookId: Id,
    patch: { title?: string; author?: string },
  ): Promise<void>;
  setBookStarred(bookId: Id, starred: boolean): Promise<void>;
  setBookFinished(bookId: Id, finished: boolean): Promise<void>;
  removeBook(bookId: Id): Promise<void>;
  createCollection(name: string): Promise<CollectionSummary>;
  renameCollection(collectionId: string, name: string): Promise<void>;
  removeCollection(collectionId: string): Promise<void>;
  assignBooksToCollection(
    bookIds: Id[],
    collectionId: string | null,
  ): Promise<void>;
}

export interface AnnotationsPort {
  listAnnotations(filter?: {
    bookId?: Id;
    query?: string;
  }): Promise<AnnotationItem[]>;
  createHighlight(input: {
    bookId: Id;
    text: string;
    anchor?: string;
    chapter?: string;
    color?: HighlightColor;
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
  /** Ambient UI control: dispatches an open request into the desktop reader. */
  openBook(bookId: Id): void;
  /** Opens the target book when needed, then navigates to the supplied locator. */
  goTo(target: { bookId?: Id; anchor?: string; chapterHref?: string }): void;
}

export interface UserInteractionOption {
  /** Stable semantic id returned to the model, distinct from the display label. */
  id: string;
  label: string;
  description?: string;
}

export type UserPermissionAction =
  "delete-book" | "delete-collection" | "delete-annotation";

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

/** 记忆 scope：单库多 scope，线程按 scope 检索（doc §4）。 */
export type MemoryScope = "user" | "global" | `book:${string}`;

export type MemoryKind = "fact" | "preference" | "insight" | "summary";

export type MemoryStatus = "active" | "superseded" | "forgotten";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  /** 0..1；初始低置信，随证据强化（doc §4 置信度） */
  importance: number;
  evidenceCount: number;
  pinned?: boolean;
  /** 缺省视为 active；superseded/forgotten 不参与检索与注入 */
  status?: MemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewMemoryInput {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  /** extraction = 逐轮提炼；agent = remember 工具；onboarding = 冷启动种子 */
  origin: "extraction" | "agent" | "onboarding";
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
  searchMemories(filter: {
    scopes: MemoryScope[];
    query?: string;
    limit?: number;
  }): Promise<MemoryRecord[]>;
  /** 全量 active 记忆 —— 巩固批处理的输入。 */
  listMemories(): Promise<MemoryRecord[]>;
  saveMemory(input: NewMemoryInput): Promise<MemoryRecord>;
  /** 提炼命中已有记忆 → 证据 +1（doc §4：反复出现才强化） */
  reinforceMemory(id: string): Promise<void>;
  applyMemoryChanges(changes: MemoryChange[]): Promise<void>;
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
   * threadKey 缺省时检索全部线程。实现方决定匹配方式（目标态是 FTS）。
   */
  searchTurns(filter: {
    query: string;
    threadKey?: string;
    limit?: number;
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

export interface BookTextHit {
  bookId: Id;
  chapterIndex: number;
  chapterTitle?: string;
  snippet: string;
  /** 命中在章节文本内的字符偏移（工具层换算成 read_chapter 的 part） */
  offset: number;
  /** exact = 原样子串；partial = 词元级回退匹配 */
  match: "exact" | "partial";
}

/**
 * 书籍正文访问（doc §11.5 抽取管道的读端）：导入时按章节抽取的纯文本。
 * 实现方决定检索方式（目标态 SQLite FTS；现状是 text/search.ts 的共享
 * 多查询扫描）；未抽取的书返回空。
 */
export interface BookTextPort {
  getToc(bookId: Id): Promise<ChapterRef[]>;
  getChapterText(bookId: Id, chapterIndex: number): Promise<string | undefined>;
  /** 一次接收多个查询变体，合并去重后的命中（减少模型的换词重试往返）。 */
  searchText(filter: {
    queries: string[];
    bookId?: Id;
    /** Inclusive upper chapter bound, used by narrative spoiler protection. */
    throughChapterIndex?: number;
    limit?: number;
  }): Promise<BookTextHit[]>;
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

export interface RuntimeDeps {
  library: LibraryPort;
  annotations: AnnotationsPort;
  reader: ReaderPort;
  interactions: UserInteractionPort;
  conversations: ConversationPort;
  profile: ProfilePort;
  memory: MemoryPort;
  bookText: BookTextPort;
  settings: SettingsPort;
  /**
   * 宿主注入的额外工具（产品侧：用户插件注册的 agent 工具）。每次 Agent
   * 组装时取一次快照；集合变化后宿主调用 `AgentRuntime.invalidateAgents()`
   * 让下一轮重建。
   */
  extraTools?: (scope: ThreadScope) => AgentTool[];
}
