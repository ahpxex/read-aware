/** Outcome for a plugin's own proposal, not a memory record or a durable receipt. */
export type MemoryCandidateOutcome =
  | { status: "saved" }
  | { status: "rejected"; reason: "invalid" | "scope" | "duplicate" | "limit" }
  | { status: "skipped"; reason: "cancelled" | "provider-unavailable" | "prior-failure" }
  | { status: "failed"; errorCode: string };

export interface MemoryCandidateReceipt {
  requestId: string;
  results: Array<{ index: number; outcome: MemoryCandidateOutcome }>;
  /** Proposals beyond the per-provider budget, not inspected or persisted. */
  discarded: number;
}
