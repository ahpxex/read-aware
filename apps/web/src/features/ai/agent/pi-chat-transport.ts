/**
 * ChatTransport 的真实现（doc §5：唯一集成面）：把 UI 的一轮请求翻译给
 * AgentRuntime，把 ThreadChunk 流翻译回 ChatStreamChunk —— text/thinking
 * 直通，tool-step 靠 id 配对并把入参提炼成一行 detail；工具名的本地化标签
 * 归 UI（ChatToolStep），这里不产任何人类可读文案。
 * 未配置 BYOK 时直接抛错 —— 对话 hook 会把消息呈现给用户。
 */
import {
  INTERACTIVE_TOOL_NAMES,
  PRESENT_TOOL_NAMES,
  type SendTurnInput,
  type SelectionAttachment,
  type ThreadScope,
} from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { AiNotConfiguredError } from "../lib/ai-errors";
import { createLogger } from "../../../platform/logger";
import type { ChatTransport } from "../lib/chat-transport";
import { toolStepDetail, toolTraceText } from "../lib/chat-stream";
import type { ChatReference, ChatStreamChunk } from "../lib/chat-types";
import type { ChatTurnRequest } from "../lib/chat-types";
import { getAgentRuntime } from "./agent-runtime";

/**
 * present_* 即时执行且卡片就是其可见输出 —— 活动行只会闪一下徒增噪音，
 * 整体抑制。lookup_word 内嵌一次模型调用（数秒），行保持可见。
 */
const SUPPRESSED_TOOLS: ReadonlySet<string> = new Set([
  ...PRESENT_TOOL_NAMES,
  ...INTERACTIVE_TOOL_NAMES,
]);

const log = createLogger("ai");

export function toAgentTurnInput(
  request: ChatTurnRequest,
  signal?: AbortSignal,
): SendTurnInput {
  const attachments: SelectionAttachment[] | undefined = request.message.attachments?.map(
    (attachment) => ({
      text: attachment.text,
      anchor: attachment.cfiRange ?? undefined,
      chapter: attachment.chapterHref ?? undefined,
    }),
  );
  return {
    text: request.message.content,
    attachments,
    readingCursor: request.readingCursor ?? undefined,
    signal,
    reset: request.reset,
  };
}

export function createPiChatTransport(): ChatTransport {
  return {
    async *sendTurn(request, signal) {
      const runtime = getAgentRuntime();
      if (!runtime) {
        throw new AiNotConfiguredError();
      }
      const scope: ThreadScope =
        request.thread === "global"
          ? // 全局线程的会话 id 就是 threadId（沿用 ChatTurnRequest 的 bookId 字段承载）
            { kind: "global", threadId: request.bookId }
          : { kind: "book", bookId: request.bookId as Id };
      for await (const chunk of runtime.sendTurn(scope, toAgentTurnInput(request, signal))) {
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
                input: toolTraceText(chunk.args),
              } satisfies ChatStreamChunk;
            } else if (chunk.phase === "update") {
              const output = toolTraceText(chunk.output);
              if (output) {
                yield {
                  type: "tool",
                  phase: "update",
                  id: chunk.id,
                  output,
                } satisfies ChatStreamChunk;
              }
            } else {
              yield {
                type: "tool",
                phase: "end",
                id: chunk.id,
                isError: chunk.isError ?? false,
                output: toolTraceText(chunk.output),
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
          case "interaction":
            if (chunk.phase === "request") {
              const request =
                chunk.request.kind === "question"
                  ? {
                      id: chunk.request.id,
                      threadKey: chunk.request.threadKey,
                      kind: "question" as const,
                      question: chunk.request.question,
                      options: chunk.request.options.map((option) => ({
                        id: option.id,
                        label: option.label,
                        description: option.description,
                      })),
                      allowCustom: chunk.request.allowCustom,
                    }
                  : {
                      id: chunk.request.id,
                      threadKey: chunk.request.threadKey,
                      kind: "permission" as const,
                      action: chunk.request.action,
                      subject: chunk.request.subject,
                    };
              yield {
                type: "interaction",
                phase: "request",
                request,
              } satisfies ChatStreamChunk;
            } else {
              yield {
                type: "interaction",
                phase: "response",
                id: chunk.id,
                answer: {
                  optionId: chunk.answer.optionId,
                  text: chunk.answer.text,
                  cancelled: chunk.answer.cancelled,
                },
              } satisfies ChatStreamChunk;
            }
            break;
          case "metric": {
            // 无 UI 消费者,但用量/延迟必须留痕 —— 日志文件是生产环境
            // 唯一的成本与 TTFB 记录(此前这里被静默丢弃)。
            const tokens = chunk.tokens
              ? `, tokens in ${chunk.tokens.input} out ${chunk.tokens.output} cacheRead ${chunk.tokens.cacheRead} cacheWrite ${chunk.tokens.cacheWrite}`
              : "";
            const cost = chunk.costUsd !== undefined ? `, cost $${chunk.costUsd.toFixed(4)}` : "";
            log.info(
              `model round ${chunk.round}: ttfb ${chunk.ttfbMs}ms, total ${chunk.totalMs}ms${tokens}${cost}`,
            );
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
