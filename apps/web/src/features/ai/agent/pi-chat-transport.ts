/**
 * ChatTransport 的真实现（doc §5：唯一集成面）：把 UI 的一轮请求翻译给
 * AgentRuntime，把 ThreadChunk 流翻译回 ChatStreamChunk —— text/thinking
 * 直通，tool-step 靠 id 配对并把入参提炼成一行 detail；工具名的本地化标签
 * 归 UI（ChatToolStep），这里不产任何人类可读文案。
 * 未配置 BYOK 时直接抛错 —— 对话 hook 会把消息呈现给用户。
 */
import { PRESENT_TOOL_NAMES, type SelectionAttachment, type ThreadScope } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import type { ChatTransport } from "../lib/chat-transport";
import { toolStepDetail } from "../lib/chat-stream";
import type { ChatReference, ChatStreamChunk } from "../lib/chat-types";
import { getAgentRuntime } from "./agent-runtime";

/**
 * present_* 即时执行且卡片就是其可见输出 —— 活动行只会闪一下徒增噪音，
 * 整体抑制。lookup_word 内嵌一次模型调用（数秒），行保持可见。
 */
const SUPPRESSED_TOOLS: ReadonlySet<string> = new Set(PRESENT_TOOL_NAMES);

export function createPiChatTransport(): ChatTransport {
  return {
    async *sendTurn(request, signal) {
      const runtime = getAgentRuntime();
      if (!runtime) {
        throw new Error("AI is not configured — add an API key in Settings → AI.");
      }
      const scope: ThreadScope =
        request.thread === "global"
          ? // 全局线程的会话 id 就是 threadId（沿用 ChatTurnRequest 的 bookId 字段承载）
            { kind: "global", threadId: request.bookId }
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
        chapter: request.chapterHref ?? undefined,
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
            if (SUPPRESSED_TOOLS.has(chunk.tool)) break;
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
          case "reference": {
            // 逐 kind 显式重建 —— 缝合层卫生：agent 包的形状变化在这里显形，
            // 而不是悄悄流进持久化的消息 parts。
            const reference: ChatReference =
              chunk.reference.kind === "books"
                ? {
                    kind: "books",
                    books: chunk.reference.books.map((book) => ({
                      bookId: book.bookId,
                      title: book.title,
                      author: book.author,
                    })),
                  }
                : {
                    kind: "words",
                    words: chunk.reference.words.map((word) => ({
                      term: word.term,
                      language: word.language,
                      entry: word.entry,
                      source: word.source,
                    })),
                  };
            yield { type: "reference", id: chunk.id, reference } satisfies ChatStreamChunk;
            break;
          }
          default:
            // "status" carries no user-facing text anymore; the transcript
            // shows its own localized "Thinking…" until the first part lands.
            break;
        }
      }
    },
  };
}
