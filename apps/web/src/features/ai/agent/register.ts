/** 启动时调用一次（main.tsx 动态引入，pi 及其依赖走独立 chunk）。 */
import { setChatTransport } from "../lib/chat-transport";
import { createPiChatTransport } from "./pi-chat-transport";

export function registerAgentChatTransport(): void {
  setChatTransport(createPiChatTransport());
}
