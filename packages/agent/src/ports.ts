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
}

/**
 * 线程转录的读写。key 是 threadScopeKey()（`book:<id>` | `global`）。
 * 运行时负责在每轮结束后 append 用户轮与助手轮（doc §10 第 5 步）；
 * 集成到产品时由端口实现负责翻译成 aiMessage.appended 事件。
 */
export interface ConversationPort {
  load(threadKey: string): Promise<TurnRecord[]>;
  append(threadKey: string, turn: TurnRecord): Promise<void>;
}

/** 用户画像摘要（user_profile_context bundle 的 v0：一段文本，无则 undefined）。 */
export interface ProfilePort {
  getProfileSummary(): Promise<string | undefined>;
}

export interface RuntimeDeps {
  library: LibraryPort;
  annotations: AnnotationsPort;
  conversations: ConversationPort;
  profile: ProfilePort;
}
