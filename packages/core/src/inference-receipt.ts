/** One-shot response metadata, not an invoice or an application-wide budget. */
export type InferenceAttemptReceipt = {
  /** Resolved catalog model; no account credentials or endpoint. */
  model: { id: string; provider: string };
  stopReason: "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
  /** Per-attempt cap requested from the SDK, null when using account defaults. */
  maxOutputTokens: number | null;
  /** SDK counters; null when unavailable/all zero. Missing individual counters remain null.
   * reasoning is included in output and must not be added again. */
  usage: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    reasoning: number | null;
    totalTokens: number | null;
  } | null;
  /** SDK estimate in USD using catalog prices; null for unknown/zero-only pricing.
   * This is not the provider's bill, including subscription and custom accounts. */
  estimatedCostUsd: number | null;
};

export type InferenceResult<T = unknown> = {
  value: T;
  /** One entry per completed attempt, including the first invalid structured reply.
   * Successful calls only; failures/cancellation still reject without a final receipt. */
  attempts: InferenceAttemptReceipt[];
};
