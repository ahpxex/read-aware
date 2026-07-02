/**
 * 线程流式输出的 chunk 类型 —— 运行时对外的最小事件面。
 * 将来 apps/web 的 PiChatTransport 适配器把它映射到 ChatStreamChunk
 * （text/status 直通，tool-step 是 §5 说的开放 union 扩展）。
 */
export type ThreadChunk =
  | { type: "status"; status: string }
  | { type: "text"; text: string }
  | { type: "tool-step"; phase: "start" | "end"; tool: string; isError?: boolean };
