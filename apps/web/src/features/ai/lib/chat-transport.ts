import type { ChatTransport } from "./chat-transport-contract";
import { createMockChatTransport } from "./mock-chat-transport";

/**
 * The transport REGISTRY. The interface itself lives in
 * `chat-transport-contract.ts` so implementations (the mock, and any real
 * backend) depend on the contract rather than on this module — otherwise the
 * default implementation and the registry that holds it import each other.
 */
export type { ChatTransport } from "./chat-transport-contract";

let activeTransport: ChatTransport = createMockChatTransport();

/** Swap in the real backend transport. Call once during app startup. */
export function setChatTransport(transport: ChatTransport): void {
  activeTransport = transport;
}

/** The transport the conversation hook talks to. Defaults to the local mock. */
export function getChatTransport(): ChatTransport {
  return activeTransport;
}
