import type { Api, AssistantMessage, Model, ModelCost } from "@earendil-works/pi-ai";
import type { InferenceAttemptReceipt } from "@read-aware/core";

/** Whether the catalog prices any token class, at the base rate or in a long-context tier. */
const isPriced = (cost: ModelCost | undefined): boolean =>
  [cost, ...(cost?.tiers ?? [])].some(
    (rates) =>
      rates !== undefined &&
      [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].some(
        (value) => Number.isFinite(value) && value > 0,
      ),
  );

const counter = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function inferenceReceipt(
  model: Model<Api>,
  message: AssistantMessage | undefined,
  maxOutputTokens?: number,
): InferenceAttemptReceipt {
  const raw = message?.usage;
  const counts = {
    input: counter(raw?.input),
    output: counter(raw?.output),
    cacheRead: counter(raw?.cacheRead),
    cacheWrite: counter(raw?.cacheWrite),
    reasoning: counter(raw?.reasoning),
    totalTokens: counter(raw?.totalTokens),
  };
  // Several adapters initialize unavailable usage and prices to zero. Do not
  // turn those placeholders into a claim of free inference.
  const usage = Object.values(counts).some((value) => value !== null && value > 0) ? counts : null;
  const priced = isPriced(model.cost);
  const cost = raw?.cost?.total;
  return {
    model: { id: model.id, provider: model.provider },
    stopReason: message?.stopReason ?? "error",
    maxOutputTokens: maxOutputTokens ?? null,
    usage,
    estimatedCostUsd: usage && priced && typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}
