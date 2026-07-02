/**
 * 滚动线程摘要（doc §4 写管道第 2 步）：每轮结束后用 fast 模型把
 * 「旧摘要 + 最新一轮」折叠成新摘要。它同时是：
 *   - 长线程的压缩层（窗口外的内容经由它进入 prompt）
 *   - 全局线程 get_conversation_insights 的数据源
 * 失败时保留旧摘要 —— 摘要永远可以从事件日志重算，宁缺勿坏。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";

const SUMMARY_PROMPT = `You maintain a rolling summary of one conversation between a reader and their reading assistant. Fold the newest exchange into the summary.

Rules:
- Keep it under 150 words, in the reader's language.
- Preserve: the reader's goals and questions, conclusions reached, open threads. Drop pleasantries and repetition.
- It must stay self-contained — someone reading only this summary should know what has been discussed so far.
- Output ONLY the new summary text, no preamble.`;

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
