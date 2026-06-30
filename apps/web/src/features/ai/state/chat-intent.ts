import { atom } from "jotai";
import type { ChatSelectionAttachment } from "../lib/chat-types";

/**
 * A pending "Ask AI about this" dispatch. The reader's selection and annotation
 * menus write here; the note panel reacts by revealing its Chat tab and the
 * composer adopts the passage as an attachment.
 */
export interface AskAiRequest {
  /** Unique per dispatch, so asking about the same passage twice re-fires. */
  id: string;
  bookId: string;
  attachment: ChatSelectionAttachment;
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
