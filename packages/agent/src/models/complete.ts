/** 单次非流式补全的 seam：后台管道（提炼等）用，测试可注入假实现。 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { LlmAccount } from "./accounts";
import type { ProviderRegistry } from "./registry";

export type CompleteFn = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

export function createCompleteFn(registry: ProviderRegistry, account: LlmAccount): CompleteFn {
  return (model, context) => registry.completeSimple(model, context, { apiKey: account.apiKey });
}
