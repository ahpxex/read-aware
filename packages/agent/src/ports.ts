/**
 * 运行时对应用数据的全部视图 —— 依赖倒置的边界。
 * agent 包不接触任何具体存储；apps/web 将来用它的投影（IndexedDB / SQLite）
 * 实现这些端口，测试用内存假实现。方法都是异步的，为的是不限定实现形态。
 */
import type { Id } from "@read-aware/core";

export interface BookOverview {
  id: Id;
  title: string;
  author?: string;
  /** 阅读进度 0..1 */
  progressFraction?: number;
  addedAt?: string;
  lastOpenedAt?: string;
}

export type AnnotationKind = "highlight" | "note" | "ask";

export interface AnnotationRecord {
  id: string;
  bookId: Id;
  kind: AnnotationKind;
  /** 选中的原文 */
  text: string;
  /** 笔记正文（note/ask 才有） */
  content?: string;
  chapter?: string;
  createdAt: string;
}

export interface TurnRecord {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface LibraryPort {
  listBooks(): Promise<BookOverview[]>;
  getBook(bookId: Id): Promise<BookOverview | undefined>;
}

export interface AnnotationsPort {
  listAnnotations(filter?: { bookId?: Id; query?: string }): Promise<AnnotationRecord[]>;
  /**
   * 记录一条 ask-note（doc §7：书线程每个提问留痕；§10 第 5 步，轮末同步落）。
   * 集成到产品时由实现翻译成 note.created {origin:"ask"} 事件。
   */
  recordAsk(input: { bookId: Id; question: string; anchor?: string; chapter?: string }): Promise<void>;
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
}

/** 用户画像摘要（user_profile_context bundle 的 v0：一段文本，无则 undefined）。 */
export interface ProfilePort {
  getProfileSummary(): Promise<string | undefined>;
  /** onboarding 与渐进式画像的写入口；实现方翻译成 profile.updated 事件。 */
  putProfileSummary(summary: string): Promise<void>;
}

export interface ChapterRef {
  index: number;
  title?: string;
}

/**
 * 书籍正文访问（doc §11.5 抽取管道的读端）：导入时按章节抽取的纯文本。
 * 实现方决定检索方式（目标态 SQLite FTS）；未抽取的书返回空。
 */
export interface BookTextPort {
  getToc(bookId: Id): Promise<ChapterRef[]>;
  getChapterText(bookId: Id, chapterIndex: number): Promise<string | undefined>;
  searchText(filter: {
    query: string;
    bookId?: Id;
    limit?: number;
  }): Promise<Array<{ bookId: Id; chapterIndex: number; chapterTitle?: string; snippet: string }>>;
}

export interface RuntimeDeps {
  library: LibraryPort;
  annotations: AnnotationsPort;
  conversations: ConversationPort;
  profile: ProfilePort;
  memory: MemoryPort;
  bookText: BookTextPort;
}
