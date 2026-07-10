/**
 * 线程流式输出的 chunk 类型 —— 运行时对外的最小事件面。
 * apps/web 的 PiChatTransport 适配器把它映射到 ChatStreamChunk：
 * text/thinking 直通增量，tool-step 靠 id 配对 start/end（§5 的开放 union）。
 */
import type { DictionaryEntry } from "./models/dictionary";

/** 被展示的书架书快照；封面与实时进度由 UI 侧按 bookId 水合。 */
export interface BookReference {
  bookId: string;
  title: string;
  author?: string;
}

/** 一张单词卡：完整词条快照 —— 生词本与现场查词同一形状。 */
export interface WordReference {
  term: string;
  /** 解释语言（人类可读名，如 "Simplified Chinese"）—— 与生词本去重口径一致。 */
  language: string;
  entry: DictionaryEntry;
  source: "vocabulary" | "lookup";
}

export type ReferencePayload =
  | { kind: "books"; books: BookReference[] }
  | { kind: "words"; words: WordReference[] };

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
    }
  /** present_* / lookup_word 主动展示的结构化引用 —— UI 渲染成卡片叠。 */
  | {
      type: "reference";
      /** 产生它的工具调用 id（pi toolCallId）—— 消费端的稳定 key。 */
      id: string;
      reference: ReferencePayload;
    }
  /** 每次模型往返结束时的度量（repl/诊断用；UI 可忽略）。 */
  | {
      type: "metric";
      /** 本轮 sendTurn 内第几次模型往返（1 起） */
      round: number;
      /** 请求发出到第一个增量的毫秒数 */
      ttfbMs: number;
      totalMs: number;
      tokens?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    };
