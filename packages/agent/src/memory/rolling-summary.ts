/**
 * 滚动线程摘要（doc §4 写管道第 2 步）：每轮结束后用 fast 模型把
 * 「旧摘要 + 最新一轮」折叠成新摘要。它同时是：
 *   - 长线程的压缩层（窗口外的内容经由它进入 prompt）
 *   - 全局线程 get_conversation_insights 的数据源
 * 失败时保留旧摘要 —— 摘要永远可以从事件日志重算，宁缺勿坏。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";
import type { TurnRecord } from "../ports";

const SUMMARY_PROMPT = `You maintain a rolling summary of one conversation between a reader and their reading assistant. Fold the newest exchange into the summary.

Rules:
- Keep it under 150 words, in the reader's language.
- Preserve: the reader's goals and questions, conclusions reached, open threads. Drop pleasantries and repetition.
- It must stay self-contained — someone reading only this summary should know what has been discussed so far.
- Output ONLY the new summary text, no preamble.`;

const BOOTSTRAP_PROMPT = `You maintain a rolling summary of one conversation between a reader and their reading assistant. This conversation existed BEFORE the summary system did — below is its recent history. Produce the initial summary.

Rules:
- Keep it under 150 words, in the reader's language.
- Preserve: the reader's goals and questions, conclusions reached, open threads. Drop pleasantries and repetition.
- It must stay self-contained — someone reading only this summary should know what has been discussed so far.
- Older assistant statements may be wrong; summarize what was DISCUSSED, do not endorse claims as facts.
- Output ONLY the summary text, no preamble.`;

/** 历史转录 → READER/ASSISTANT 行（bootstrap 摘要与继承提炼共用的格式）。 */
export function formatTurnsForFolding(turns: TurnRecord[]): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "READER" : "ASSISTANT"}: ${turn.content}`)
    .join("\n\n");
}

export interface BootstrapSummaryInput {
  complete: CompleteFn;
  model: Model<Api>;
  /** 领养窗口：调用方截好的历史尾部（不含当前轮）。 */
  turns: TurnRecord[];
}

/**
 * 旧线程领养的第一步：把摘要系统上线前就存在的对话历史折叠成初始滚动
 * 摘要。失败返回 undefined（这一轮按无摘要继续，下一轮门条件仍成立、
 * 自动重试）。
 */
export async function bootstrapSummaryFromHistory(
  input: BootstrapSummaryInput,
): Promise<string | undefined> {
  if (input.turns.length === 0) return undefined;
  try {
    const message = await input.complete(input.model, {
      systemPrompt: BOOTSTRAP_PROMPT,
      messages: [
        {
          role: "user",
          content: `Conversation history:\n${formatTurnsForFolding(input.turns)}`,
          timestamp: Date.now(),
        },
      ],
    });
    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

export interface UpdateSummaryInput {
  complete: CompleteFn;
  model: Model<Api>;
  previous: string | undefined;
  userText: string;
  assistantText: string;
}

export async function updateRollingSummary(input: UpdateSummaryInput): Promise<string | undefined> {
  try {
    const message = await input.complete(input.model, {
      systemPrompt: SUMMARY_PROMPT,
      messages: [
        {
          role: "user",
          content: `Current summary:\n${input.previous ?? "(none — this is the first exchange)"}\n\nNewest exchange:\nREADER: ${input.userText}\n\nASSISTANT: ${input.assistantText}`,
          timestamp: Date.now(),
        },
      ],
    });
    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return text || input.previous;
  } catch {
    return input.previous;
  }
}
