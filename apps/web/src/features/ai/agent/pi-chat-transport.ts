/**
 * ChatTransport 的真实现（doc §5：唯一集成面）：把 UI 的一轮请求翻译给
 * AgentRuntime，把 ThreadChunk 流翻译回 ChatStreamChunk —— text/thinking
 * 直通，tool-step 靠 id 配对并把入参提炼成一行 detail；工具名的本地化标签
 * 归 UI（ChatToolStep），这里不产任何人类可读文案。
 * 未配置 BYOK 时直接抛错 —— 对话 hook 会把消息呈现给用户。
 */
import type { SelectionAttachment, ThreadScope } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import type { ChatTransport } from "../lib/chat-transport";
import { toolStepDetail } from "../lib/chat-stream";
import type { ChatStreamChunk } from "../lib/chat-types";
import { getAgentRuntime } from "./agent-runtime";

export function createPiChatTransport(): ChatTransport {
  return {
    async *sendTurn(request, signal) {
      const runtime = getAgentRuntime();
      if (!runtime) {
        throw new Error("AI is not configured — add an API key in Settings → AI.");
      }
      const scope: ThreadScope =
        request.thread === "global"
          ? { kind: "global" }
          : { kind: "book", bookId: request.bookId as Id };
      const attachments: SelectionAttachment[] | undefined = request.message.attachments?.map(
        (attachment) => ({
          text: attachment.text,
          anchor: attachment.cfiRange ?? undefined,
          chapter: attachment.chapterHref ?? undefined,
        }),
      );
      for await (const chunk of runtime.sendTurn(scope, {
        text: request.message.content,
        attachments,
        signal,
      })) {
        switch (chunk.type) {
          case "text":
            yield { type: "text", text: chunk.text } satisfies ChatStreamChunk;
            break;
          case "thinking":
            yield { type: "thinking", text: chunk.text } satisfies ChatStreamChunk;
            break;
          case "tool-step":
            if (chunk.phase === "start") {
              yield {
                type: "tool",
                phase: "start",
                id: chunk.id,
                tool: chunk.tool,
                detail: toolStepDetail(chunk.tool, chunk.args),
              } satisfies ChatStreamChunk;
            } else {
              yield {
                type: "tool",
                phase: "end",
                id: chunk.id,
                isError: chunk.isError ?? false,
              } satisfies ChatStreamChunk;
            }
            break;
          default:
            // "status" carries no user-facing text anymore; the transcript
            // shows its own localized "Thinking…" until the first part lands.
            break;
        }
      }
    },
  };
}
