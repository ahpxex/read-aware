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

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Passages attached to a turn — only present on user messages. */
  attachments?: ChatAttachment[];
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
 * - `text`   — a delta to append to the assistant message.
 * - `status` — optional human-readable progress (e.g. "Searching your notes…").
 *
 * The union is intentionally open: an agent backend can add richer events
 * (citations, tool steps) later, and the UI's exhaustive `switch` will simply
 * ignore what it doesn't yet render.
 */
export type ChatStreamChunk =
  | { type: "text"; text: string }
  | { type: "status"; status: string };
