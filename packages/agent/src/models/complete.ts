/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { LlmAccount } from "./accounts";
import type { ProviderRegistry } from "./registry";
import type { ThinkingLevel } from "./roles";

export type CompleteFn = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

/** "off" → 不发 reasoning 参数；其余原样传给 pi。 */
function asReasoning(thinking?: ThinkingLevel) {
  return thinking && thinking !== "off" ? thinking : undefined;
}

export function createCompleteFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
): CompleteFn {
  const reasoning = asReasoning(thinking);
  return (model, context) =>
    registry.completeSimple(model, context, { apiKey: account.apiKey, reasoning });
}

/** 同一 seam 的流式形态：`ask({ onText })` 消费，事件流以 result() 收束。 */
export type StreamFn = (model: Model<Api>, context: Context) => AssistantMessageEventStream;

export function createStreamFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
): StreamFn {
  const reasoning = asReasoning(thinking);
  return (model, context) =>
    registry.streamSimple(model, context, { apiKey: account.apiKey, reasoning });
}
