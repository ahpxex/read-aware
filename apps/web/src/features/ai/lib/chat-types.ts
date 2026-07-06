/**
 * Shared types for the per-book AI conversation.
 *
 * ReadAware models AI as one persistent conversation per book (not a thread per
 * selection): "Ask AI about this" pulls a passage into the ongoing conversation
 * as an attachment rather than opening a new window. These types are the vocab
 * the UI and the response seam (`chat-transport`) agree on; the system/agent
 * persona, retrieval and memory all live behind the seam, not here.
 */

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

export type ChatAssistantPart = ChatTextPart | ChatThinkingPart | ChatToolPart;

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
}

/**
 * Incremental output from the transport.
 * - `text`     — a delta to append to the visible reply.
 * - `thinking` — a delta of model reasoning (rendered collapsed).
 * - `tool`     — a tool call starting or ending, paired by `id`.
 * - `status`   — optional human-readable progress fallback.
 *
 * The union stays open: a backend can add richer events (citations, images)
 * later, and the UI's `switch` will simply ignore what it doesn't yet render.
 */
export type ChatStreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; phase: "start"; id: string; tool: string; detail?: string }
  | { type: "tool"; phase: "end"; id: string; isError: boolean }
  | { type: "status"; status: string };
