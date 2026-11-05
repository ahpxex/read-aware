/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import {
  mergeClientIdentity,
  type Api,
  type AssistantMessage,
  type Context,
  type FetchFunction,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isCustomOpenAIAccount, type LlmAccount } from "./accounts";
import { sanitizeCustomOpenAIPayload } from "./custom-openai";
import { READAWARE_IDENTITY } from "./identity";
import type { ProviderRegistry } from "./registry";
import type { ThinkingLevel } from "./roles";
import { asProviderFetch, type AgentFetch } from "./transport";

/** Host lifecycle tracking observes the provider's actual terminal promise. */
export type InferenceSourceTracking = { trackSource?: (source: Promise<unknown>) => void };

export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options?: { signal?: AbortSignal; maxTokens?: number } & InferenceSourceTracking,
) => Promise<AssistantMessage>;

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
  // Explicit per-call caps must survive compatibility sanitation. The relay
  // can impose a stricter subscription cap independently.
  const sanitizedMaxOutputTokens = isCustomOpenAIAccount(account)
    ? base.maxTokens === undefined
      ? account.maxOutputTokens
      : Math.min(base.maxTokens, account.maxOutputTokens ?? base.maxTokens)
    : base.maxTokens;
  const onPayload =
    isCustomOpenAIAccount(account) || account.kind === "readaware"
      ? async (payload: unknown, model: Model<Api>) => {
          const transformed = await upstreamPayload?.(payload, model);
          return sanitizeCustomOpenAIPayload(
            transformed === undefined ? payload : transformed,
            sanitizedMaxOutputTokens,
          );
        }
      : upstreamPayload;

  return {
    ...base,
    ...(base.maxTokens === undefined ? {} : { maxTokens: sanitizedMaxOutputTokens }),
    apiKey: account.kind === "readaware" ? account.session : account.apiKey,
    reasoning: thinking === undefined ? base.reasoning : asReasoning(thinking),
    fetch: fetch ?? base.fetch,
    onPayload,
    // Every request, background pipelines included, is attributed to ReadAware.
    identity: mergeClientIdentity(base.identity, READAWARE_IDENTITY),
  };
}

export function createCompleteFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
  fetch?: AgentFetch,
): CompleteFn {
  const providerFetch = asProviderFetch(fetch);
  return async (model, context, options) => {
    const { trackSource, ...providerOptions } = options ?? {};
    const result = registry.completeSimple(
      model,
      context,
      requestOptions(account, thinking, providerFetch, providerOptions),
    );
    trackSource?.(result);
    return result;
  };
}

/** 同一 seam 的流式形态：`ask({ onText })` 消费，事件流以 result() 收束。 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions & InferenceSourceTracking,
) => AssistantMessageEventStream;

export function createStreamFn(
  registry: ProviderRegistry,
  account: LlmAccount,
  thinking?: ThinkingLevel,
  fetch?: AgentFetch,
): StreamFn {
  const providerFetch = asProviderFetch(fetch);
  return (model, context, options) => {
    const { trackSource, ...providerOptions } = options ?? {};
    const source = registry.streamSimple(
      model,
      context,
      requestOptions(account, thinking, providerFetch ?? options?.fetch, providerOptions),
    );
    trackSource?.(source.result());
    return source;
  };
}
