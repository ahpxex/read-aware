/**
 * 线程流式输出的 chunk 类型 —— 运行时对外的最小事件面。
 * apps/web 的 PiChatTransport 适配器把它映射到 ChatStreamChunk：
 * text/thinking 直通增量，tool-step 靠 id 配对 start/end（§5 的开放 union）。
 */
export type ThreadChunk =
  | { type: "status"; status: string }
  | { type: "text"; text: string }
  /** 模型的思考增量（开启 thinking 的模型才会出现）。 */
  | { type: "thinking"; text: string }
  | {
      type: "tool-step";
      phase: "start" | "end";
      /** pi 的 toolCallId —— 消费端用它配对同一次调用的 start/end。 */
      id: string;
      tool: string;
      /** 仅 start：原始工具入参，供 UI 提炼一行摘要（如检索词）。 */
      args?: unknown;
      /** 仅 end。 */
      isError?: boolean;
    };
