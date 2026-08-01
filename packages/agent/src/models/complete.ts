/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import type {
  Api,
  AssistantMessage,
  Context,
  FetchFunction,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isCustomOpenAIAccount, type LlmAccount } from "./accounts";
import { sanitizeCustomOpenAIPayload } from "./custom-openai";
import type { ProviderRegistry } from "./registry";
import type { ThinkingLevel } from "./roles";
import { asProviderFetch, type AgentFetch } from "./transport";

export type CompleteFn = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

/** "off" → 不发 reasoning 参数；其余原样传给 pi。 */
function asReasoning(thinking?: ThinkingLevel) {
  return thinking && thinking !== "off" ? thinking : undefined;
}

function requestOptions(
  account: LlmAccount,
  thinking?: ThinkingLevel,
  fetch?: FetchFunction,
  base: SimpleStreamOptions = {},
): SimpleStreamOptions {
  const upstreamPayload = base.onPayload;
  const onPayload = isCustomOpenAIAccount(account)
    ? async (payload: unknown, model: Model<Api>) => {
        const transformed = await upstreamPayload?.(payload, model);
        return sanitizeCustomOpenAIPayload(
          transformed === undefined ? payload : transformed,
          account.maxOutputTokens,
        );
      }
    : upstreamPayload;

  return {
    ...base,
    apiKey: account.apiKey,
    reasoning:
      thinking === undefined ? base.reasoning : asReasoning(thinking),
    fetch: fetch ?? base.fetch,
    onPayload,
  };
}

export function createCompleteFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
  fetch?: AgentFetch,
): CompleteFn {
  const providerFetch = asProviderFetch(fetch);
  return (model, context) =>
    registry.completeSimple(
      model,
      context,
      requestOptions(account, thinking, providerFetch),
    );
}

/** 同一 seam 的流式形态：`ask({ onText })` 消费，事件流以 result() 收束。 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export function createStreamFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
  fetch?: AgentFetch,
): StreamFn {
  const providerFetch = asProviderFetch(fetch);
  return (model, context, options) =>
    registry.streamSimple(
      model,
      context,
      requestOptions(account, thinking, providerFetch, options),
    );
}
