/**
 * Shared types for the per-book AI conversation.
 *
 * ReadAware models AI as one persistent conversation per book (not a thread per
 * selection): "Ask AI about this" pulls a passage into the ongoing conversation
 * as an attachment rather than opening a new window. These types are the vocab
 * the UI and the response seam (`chat-transport`) agree on; the system/agent
 * persona, retrieval and memory all live behind the seam, not here.
 */

import type { DictionaryEntry } from "@read-aware/agent";

/** A speaking role in the conversation. */
export type ChatRole = "user" | "assistant";

/**
 * A passage the reader pulled in via "Ask AI about this". Carries the quoted
 * text (shown as a chip) plus the location, so a future backend can resolve the
 * exact spot for retrieval or citation.
 */
export interface ChatSelectionAttachment {
  kind: "selection";
  text: string;
  cfiRange: string | null;
  chapterHref: string | null;
}

export type ChatAttachment = ChatSelectionAttachment;

/** A run of visible reply prose (rendered as Markdown). */
export interface ChatTextPart {
  type: "text";
  text: string;
}

/** A run of model reasoning — shown collapsed, never part of `content`. */
export interface ChatThinkingPart {
  type: "thinking";
  text: string;
}

/**
 * One tool call in the turn. `detail` is a short human-readable argument
 * summary (e.g. the search query) distilled by the transport; the UI maps
 * `tool` to a localized label.
 */
export interface ChatToolPart {
  type: "tool";
  id: string;
  tool: string;
  detail?: string;
  state: "running" | "done" | "error";
}

/**
 * A shelf book the assistant chose to show as a card. Only a light snapshot is
 * persisted — cover art and live progress hydrate at render time by `bookId`
 * (covers are multi-KB data URLs; embedding them per message would bloat the
 * transcript), with the snapshot as the fallback when the book was removed.
 */
export interface ChatBookReference {
  bookId: string;
  title: string;
  author?: string;
}

/**
 * A word card, self-contained: the full dictionary entry travels with the
 * message so the card renders identically for vocabulary words and live
 * lookups, and survives the word being removed from the vocabulary.
 */
export interface ChatWordReference {
  term: string;
  /** Explanation language (human-readable name) — the vocabulary identity key. */
  language: string;
  entry: DictionaryEntry;
  source: "vocabulary" | "lookup";
}

export type ChatReference =
  | { kind: "books"; books: ChatBookReference[] }
  | { kind: "words"; words: ChatWordReference[] };

/**
 * A stack of reference cards the assistant chose to show (via its present /
 * lookup tools), placed in the timeline where the tool was called — between
 * prose blocks. Contributes nothing to `content`.
 */
export interface ChatReferencePart {
  type: "reference";
  /** Id of the producing tool call — stable render key and dedupe identity. */
  id: string;
  reference: ChatReference;
}

export type ChatAssistantPart =
  | ChatTextPart
  | ChatThinkingPart
  | ChatToolPart
  | ChatReferencePart;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Passages attached to a turn — only present on user messages. */
  attachments?: ChatAttachment[];
  /**
   * The assistant turn as an ordered timeline (prose, thinking, tool calls).
   * `content` stays the plain-text reply — the projection older messages,
   * persistence consumers and the agent's own history read. Absent on user
   * messages and on messages persisted before parts existed.
   */
  parts?: ChatAssistantPart[];
  /**
   * Set when the turn that produced this assistant message failed — the
   * transport threw. `content` may hold a partial reply, or be empty when the
   * failure hit before any prose. Failed messages are excluded from the
   * agent's history hydration (see the conversation port).
   */
  error?: string;
  /**
   * Structured code for a recognized failure (see `ai-errors.ts`). The UI
   * renders localized copy and a fix affordance from the code; `error` keeps
   * the raw thrown message as the fallback for unrecognized failures.
   */
  errorCode?: string;
}

/**
 * One request across the seam: the full prior history of this book's
 * conversation plus the new user turn. The transport decides what to do with it
 * (call an agent, retrieve memory, assemble context); the UI stays ignorant of
 * how the reply is produced.
 */
export interface ChatTurnRequest {
  bookId: string;
  bookTitle: string;
  history: ChatMessage[];
  message: ChatMessage;
  /**
   * 线程 scope：缺省为书线程；"global" 是跨书总线程（Context 页），
   * 此时 bookId 为伪 id（见 conversation-port 的 GLOBAL_CONVERSATION_ID）。
   */
  thread?: "book" | "global";
  /**
   * 发送时刻阅读器所在章节（href）。书线程的章节会话边界信号：同章节的
   * 轮次共享上下文，换章节发新消息才重置（agent 包 doc §5）。全局线程忽略。
   */
  chapterHref?: string | null;
  /**
   * Retry/regenerate：UI 已截断并持久化转录，transport 应丢弃线程内存态，
   * 让本轮从持久转录重建（否则被丢弃的回答仍留在 agent 的上下文里）。
   */
  reset?: boolean;
}

/**
 * Incremental output from the transport.
 * - `text`      — a delta to append to the visible reply.
 * - `thinking`  — a delta of model reasoning (rendered collapsed).
 * - `tool`      — a tool call starting or ending, paired by `id`.
 * - `reference` — a stack of book/word cards the assistant chose to show.
 * - `status`    — optional human-readable progress fallback.
 *
 * The union stays open: a backend can add richer events (citations, images)
 * later, and the UI's `switch` will simply ignore what it doesn't yet render.
 */
export type ChatStreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; phase: "start"; id: string; tool: string; detail?: string }
  | { type: "tool"; phase: "end"; id: string; isError: boolean }
  | { type: "reference"; id: string; reference: ChatReference }
  | { type: "status"; status: string };
