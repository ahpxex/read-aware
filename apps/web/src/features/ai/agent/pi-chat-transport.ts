/**
 * ChatTransport 的真实现（doc §5：唯一集成面）：把 UI 的一轮请求翻译给
 * AgentRuntime，把 ThreadChunk 流翻译回 ChatStreamChunk。
 * 未配置 BYOK 时直接抛错 —— 对话 hook 会把消息呈现给用户。
 */
import type { SelectionAttachment, ThreadScope } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import type { ChatTransport } from "../lib/chat-transport";
import type { ChatStreamChunk } from "../lib/chat-types";
import { getAgentRuntime } from "./agent-runtime";

const TOOL_LABELS: Record<string, string> = {
  search_memory: "Recalling…",
  remember: "Remembering…",
  search_conversation: "Checking what was said…",
  get_conversation_insights: "Reading the book thread…",
  list_books: "Looking at the shelf…",
  get_book_overview: "Looking at the book…",
  get_annotations: "Reading your highlights…",
  get_toc: "Opening the book…",
  read_chapter: "Reading the text…",
  search_book_text: "Searching the text…",
};

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
        if (chunk.type === "text") {
          yield { type: "text", text: chunk.text } satisfies ChatStreamChunk;
        } else if (chunk.type === "status") {
          yield { type: "status", status: "Thinking…" } satisfies ChatStreamChunk;
        } else if (chunk.phase === "start") {
          yield {
            type: "status",
            status: TOOL_LABELS[chunk.tool] ?? "Working…",
          } satisfies ChatStreamChunk;
        }
      }
    },
  };
}
