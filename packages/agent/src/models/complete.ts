/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isCustomOpenAIAccount, type LlmAccount } from "./accounts";
import { sanitizeCustomOpenAIPayload } from "./custom-openai";
import type { ProviderRegistry } from "./registry";
import type { ThinkingLevel } from "./roles";

export type CompleteFn = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

/** "off" → 不发 reasoning 参数；其余原样传给 pi。 */
function asReasoning(thinking?: ThinkingLevel) {
  return thinking && thinking !== "off" ? thinking : undefined;
}

function requestOptions(account: LlmAccount, thinking?: ThinkingLevel) {
  return {
    apiKey: account.apiKey,
    reasoning: asReasoning(thinking),
    onPayload: isCustomOpenAIAccount(account)
      ? (payload: unknown) =>
          sanitizeCustomOpenAIPayload(payload, account.maxOutputTokens)
      : undefined,
  };
}

export function createCompleteFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
): CompleteFn {
  return (model, context) =>
    registry.completeSimple(model, context, requestOptions(account, thinking));
}

/** 同一 seam 的流式形态：`ask({ onText })` 消费，事件流以 result() 收束。 */
export type StreamFn = (model: Model<Api>, context: Context) => AssistantMessageEventStream;

export function createStreamFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
): StreamFn {
  return (model, context) =>
    registry.streamSimple(model, context, requestOptions(account, thinking));
}
