/**
 * 全局线程标题：第一轮对话之后用 fast 档起一个短标题，写成
 * `aiConversation.titled` 事件（经 ConversationPort.titleThread）。
 *
 * 资格只有一条——全局线程、有带文字的用户消息、还没有标题——轮后触发
 * 与空闲回填共用，所以首次失败会在下一轮或下一个空闲节拍自然重试；
 * 已有标题的线程永远不再花钱。账户类失败（鉴权/配额/限流）立即停下
 * 本次扫描；模型给出不像标题的输出时，本会话内不再为该线程重试。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { ERR_AI_AUTH, ERR_AI_NOT_CONFIGURED, ERR_AI_QUOTA, ERR_AI_RATE_LIMITED, errorCode } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { AgentLogPort, ConversationPort } from "../ports";
import { replyLanguageAnchor } from "./reading-cursor";

/** The longest generated title kept; longer output is a sentence, not a title. */
export const GENERATED_TITLE_MAX_CHARS = 60;

/** Room for a thinking model's reasoning before the few words of the title. */
const TITLE_MAX_OUTPUT_TOKENS = 1024;

/** How much of the exchange the title is written from. */
const USER_TEXT_CHARS = 2000;
const ASSISTANT_TEXT_CHARS = 1500;

function titlePrompt(language: string): string {
  return `You name a conversation between a reader and their reading assistant, for the reader's list of conversations.

Rules:
- A short phrase naming what the conversation is about: 2–6 words, or 4–12 characters in Chinese or Japanese.
- Write it in ${language}.
- No quotation marks, no ending punctuation, no emoji, and no framing such as "Conversation about" or "Question:".
- Output ONLY the title.`;
}

// Wrapping quotes and markdown emphasis; not 《》, which mark a book's title.
const QUOTES = /^[\s"'“”‘’「」『』«»`*_#]+|[\s"'“”‘’「」『』«»`*_#]+$/gu;
const TRAILING_PUNCTUATION = /[\s.。!！?？,，;；:：、…~～-]+$/u;
const LABEL = /^(?:title|标题|題目|标题是|タイトル|titre|titel|título|название)\s*[:：]\s*/iu;

/**
 * The model's output as a title, or undefined when it is not one: the first
 * non-empty line, without a label, wrapping quotes or trailing punctuation,
 * whitespace collapsed; rejected when empty or longer than a title runs.
 */
export function sanitizeThreadTitle(raw: string): string | undefined {
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return undefined;
  let title = line.replace(LABEL, "").replace(QUOTES, "").replace(TRAILING_PUNCTUATION, "").replace(QUOTES, "");
  title = title.replace(/\s+/gu, " ").trim();
  if (!title) return undefined;
  if (Array.from(title).length > GENERATED_TITLE_MAX_CHARS) return undefined;
  return title;
}

export interface GenerateThreadTitleInput {
  complete: CompleteFn;
  model: Model<Api>;
  userText: string;
  assistantText?: string;
  signal?: AbortSignal;
}

/** One fast-model call naming an exchange; undefined when the output is not a usable title. */
export async function generateThreadTitle(input: GenerateThreadTitleInput): Promise<string | undefined> {
  const exchange = input.assistantText
    ? `READER: ${input.userText.slice(0, USER_TEXT_CHARS)}\n\nASSISTANT: ${input.assistantText.slice(0, ASSISTANT_TEXT_CHARS)}`
    : `READER: ${input.userText.slice(0, USER_TEXT_CHARS)}`;
  const message = await input.complete(
    input.model,
    {
      systemPrompt: titlePrompt(replyLanguageAnchor(input.userText)),
      messages: [{ role: "user", content: `Conversation:\n${exchange}`, timestamp: Date.now() }],
    },
    { signal: input.signal, maxTokens: TITLE_MAX_OUTPUT_TOKENS },
  );
  const text = message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
  return sanitizeThreadTitle(text);
}

/** Failures that will fail the same way for every thread until the account changes. */
const ACCOUNT_FAILURES = new Set<string>([ERR_AI_AUTH, ERR_AI_QUOTA, ERR_AI_RATE_LIMITED, ERR_AI_NOT_CONFIGURED]);

export interface ThreadTitleReport {
  titled: number;
  /** The pass stopped early on an account failure. */
  halted: boolean;
}

/**
 * Titles untitled global threads, one fast-model call each. A thread being
 * titled is not taken again until it settles; one whose output was not a
 * title is skipped for the rest of the session.
 */
export class ThreadTitler {
  private readonly inFlight = new Set<string>();
  private readonly unusable = new Set<string>();

  constructor(
    private readonly options: {
      conversations: ConversationPort;
      complete: CompleteFn;
      model: () => Model<Api>;
      log?: AgentLogPort;
    },
  ) {}

  async run(query: { limit: number; threadKey?: string; signal?: AbortSignal }): Promise<ThreadTitleReport> {
    const { conversations, complete, model, log } = this.options;
    const candidates = await conversations.untitledThreads({
      // Ask for enough to fill `limit` past threads already in flight or skipped.
      limit: query.limit + this.inFlight.size + this.unusable.size,
      threadKey: query.threadKey,
    });
    let titled = 0;
    let attempted = 0;
    for (const candidate of candidates) {
      if (attempted >= query.limit) break;
      if (query.signal?.aborted) break;
      if (this.inFlight.has(candidate.threadKey) || this.unusable.has(candidate.threadKey)) continue;
      attempted += 1;
      this.inFlight.add(candidate.threadKey);
      try {
        const title = await generateThreadTitle({
          complete,
          model: model(),
          userText: candidate.userText,
          assistantText: candidate.assistantText,
          signal: query.signal,
        });
        if (!title) {
          this.unusable.add(candidate.threadKey);
          log?.warn("Thread title output was not a title; not retried this session");
          continue;
        }
        await conversations.titleThread(candidate.threadKey, title, candidate.messageId);
        titled += 1;
      } catch (error) {
        const code = errorCode(error);
        if (code && ACCOUNT_FAILURES.has(code)) {
          log?.warn("Thread titling stopped: the model account cannot serve it now", error);
          return { titled, halted: true };
        }
        log?.warn("Titling a thread failed; it is retried on a later pass", error);
      } finally {
        this.inFlight.delete(candidate.threadKey);
      }
    }
    return { titled, halted: false };
  }
}
