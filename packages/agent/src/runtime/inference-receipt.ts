import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { InferenceAttemptReceipt } from "@read-aware/core";

const counter = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function inferenceReceipt(model: Model<Api>, message: AssistantMessage, maxOutputTokens?: number): InferenceAttemptReceipt {
  const raw = message.usage;
  const counts = {
    input: counter(raw?.input), output: counter(raw?.output),
    cacheRead: counter(raw?.cacheRead), cacheWrite: counter(raw?.cacheWrite),
    reasoning: counter(raw?.reasoning), totalTokens: counter(raw?.totalTokens),
  };
  // Several adapters initialize unavailable usage and prices to zero. Do not
  // turn those placeholders into a claim of free inference.
  const usage = Object.values(counts).some(value => value !== null && value > 0) ? counts : null;
  const priced = Object.values(model.cost ?? {}).some(value => Number.isFinite(value) && value > 0);
  const cost = raw?.cost?.total;
  return {
    model: { id: model.id, provider: model.provider }, stopReason: message.stopReason,
    maxOutputTokens: maxOutputTokens ?? null, usage,
    estimatedCostUsd: usage && priced && typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}
