import type { ChatStreamChunk, ChatTurnRequest } from "./chat-types";
import { createMockChatTransport } from "./mock-chat-transport";

/**
 * ───────────────────────────── THE AI SEAM ─────────────────────────────
 *
 * Everything the UI does — the reader, the per-book conversation, streaming,
 * persistence, the composer — is finished and backend-agnostic. The one thing
 * it does NOT own is where assistant replies come from. That is this interface.
 *
 * Today a local mock answers (so the whole frontend is demoable offline). When
 * the ReadAware agent backend (or a thin LLM proxy) is ready, implement
 * `ChatTransport` against it and register it once at app startup:
 *
 *     setChatTransport(myBackendTransport)
 *
 * Nothing above this line changes. That is the entire integration surface.
 */
export interface ChatTransport {
  /**
   * Stream an assistant reply for a single user turn. Implementations should:
   *  - yield `text` chunks as the reply is produced (and optional `status`),
   *  - honour `signal` — stop promptly when the user aborts,
   *  - throw on failure; the conversation hook surfaces the message.
   *
   * The returned iterable is consumed exactly once.
   */
  sendTurn(
    request: ChatTurnRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk>;
}

let activeTransport: ChatTransport = createMockChatTransport();

/** Swap in the real backend transport. Call once during app startup. */
export function setChatTransport(transport: ChatTransport): void {
  activeTransport = transport;
}

/** The transport the conversation hook talks to. Defaults to the local mock. */
export function getChatTransport(): ChatTransport {
  return activeTransport;
}
