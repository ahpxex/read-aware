import { atom } from "jotai";
import type { ChatSelectionAttachment } from "../lib/chat-types";

/**
 * A pending dispatch into the book's conversation. The reader's selection and
 * annotation menus write a passage here; the end-of-book screen writes a
 * question. Either way the note panel reveals its Chat tab, then adopts the
 * passage as an attachment or sends the question outright.
 */
export interface AskAiRequest {
  /** Unique per dispatch, so asking about the same passage twice re-fires. */
  id: string;
  bookId: string;
  /**
   * A passage to hand the composer, leaving the question to the reader. This is
   * the selection-menu path.
   */
  attachment?: ChatSelectionAttachment;
  /**
   * A question to send straight away, with no passage — the end-of-book "look
   * back" acts as a shortcut into the conversation, so the agent answers with
   * its own tools and the reader can follow up in the same thread.
   */
  prompt?: string;
}

/**
 * Cross-component signal between the reader (where selection lives) and the
 * note panel (where the conversation lives) — they're siblings under
 * `ReaderWorkspace`, so an atom is the natural bridge.
 *
 * Consumers track the last `id` they handled rather than clearing this, so the
 * shell (opens the Chat tab) and the panel (adopts the attachment) can both
 * react to the same dispatch without a clear-vs-read race.
 */
export const askAiRequestAtom = atom<AskAiRequest | null>(null);

/**
 * A pending "open this book" dispatch from a chat book card. The reader session
 * lives far up the tree (App); cards live inside whichever chat surface is
 * mounted — an atom bridges them the same way askAiRequestAtom does.
 */
export interface OpenBookRequest {
  /** Unique per dispatch, so clicking the same card twice re-fires. */
  id: string;
  bookId: string;
}

export const openBookRequestAtom = atom<OpenBookRequest | null>(null);
