/**
 * ChatTransport 的真实现（doc §5：唯一集成面）：把 UI 的一轮请求翻译给
 * AgentRuntime，把 ThreadChunk 流翻译回 ChatStreamChunk。
 * 没有可用的 BYOK 配置时逐轮回退到 mock —— 离线 demo 行为保持不变，
 * 配置好 key 的下一轮自动切到真 agent，无需重启。
 */
import type { SelectionAttachment, ThreadScope } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import type { ChatTransport } from "../lib/chat-transport";
import type { ChatStreamChunk } from "../lib/chat-types";
import { createMockChatTransport } from "../lib/mock-chat-transport";
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
  const mock = createMockChatTransport();
  return {
    async *sendTurn(request, signal) {
      const runtime = getAgentRuntime();
      if (!runtime) {
        yield* mock.sendTurn(request, signal);
        return;
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
