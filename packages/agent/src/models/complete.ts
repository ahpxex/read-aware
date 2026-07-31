/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { LlmAccount } from "./accounts";
import type { ProviderRegistry } from "./registry";

export type CompleteFn = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

export function createCompleteFn(registry: ProviderRegistry, account: LlmAccount): CompleteFn {
  return (model, context) => registry.completeSimple(model, context, { apiKey: account.apiKey });
}

/** 同一 seam 的流式形态：`ask({ onText })` 消费，事件流以 result() 收束。 */
export type StreamFn = (model: Model<Api>, context: Context) => AssistantMessageEventStream;

export function createStreamFn(registry: ProviderRegistry, account: LlmAccount): StreamFn {
  return (model, context) => registry.streamSimple(model, context, { apiKey: account.apiKey });
}
