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
import { guardedInferenceStream, inferenceCall, type InferenceCall, type InferencePolicy } from "./inference-policy";

function callFetch(fetch: FetchFunction | undefined, call: InferenceCall | undefined): FetchFunction | undefined {
  if (!call) return fetch;
  const transport = fetch ?? globalThis.fetch;
  return asProviderFetch((input, init) => {
    call.assertAllowed();
    return transport(input, init);
  });
}

export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options?: { signal?: AbortSignal },
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
  // The readaware subscription rides the same custom-openai wire, so its
  // payloads need the same compatibility sanitation; its output cap lives on
  // the relay proxy, hence no client-side maxOutputTokens.
  const sanitizedMaxOutputTokens = isCustomOpenAIAccount(account)
    ? account.maxOutputTokens
    : undefined;
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
    apiKey: account.kind === "readaware" ? account.session : account.apiKey,
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
  policy?: InferencePolicy,
): CompleteFn {
  const providerFetch = asProviderFetch(fetch);
  return async (model, context, options) => {
    const call = policy ? inferenceCall(policy, options?.signal) : undefined;
    try {
      call?.assertAllowed();
      const result = registry.completeSimple(
        model,
        context,
        requestOptions(account, thinking, callFetch(providerFetch, call), call ? { ...options, signal: call.signal } : options),
      );
      const message = await (call ? call.wait(result) : result);
      call?.assertAllowed();
      return message;
    } finally { call?.dispose(); }
  };
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
  policy?: InferencePolicy,
): StreamFn {
  const providerFetch = asProviderFetch(fetch);
  return (model, context, options) => {
    const call = policy ? inferenceCall(policy, options?.signal) : undefined;
    const start = () => registry.streamSimple(
      model,
      context,
      requestOptions(account, thinking, callFetch(providerFetch ?? options?.fetch, call), call ? { ...options, signal: call.signal } : options),
    );
    return call ? guardedInferenceStream(model, call, start) : start();
  };
}
