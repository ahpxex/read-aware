/** 启动时调用一次（main.tsx）。 */
import { setChatTransport } from "../lib/chat-transport";
import { createPiChatTransport } from "./pi-chat-transport";

export function registerAgentChatTransport(): void {
  setChatTransport(createPiChatTransport());
}
