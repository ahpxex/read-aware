import { AppError } from "@read-aware/core";

export const PLUGIN_HOST_LIMITS = Object.freeze({
  calls: 1024,
  invokes: 1024,
  registrations: 16_384,
  callbacks: 500_000,
});
type Resource = keyof typeof PLUGIN_HOST_LIMITS;
export type BudgetLease = { release(count?: number): void };

/** Leases follow actual host resources, never a Worker's claimed release count. */
export class PluginHostBudget {
  private readonly counts: Record<Resource, number> = { calls: 0, invokes: 0, registrations: 0, callbacks: 0 };
  constructor(private readonly limits: Record<Resource, number> = PLUGIN_HOST_LIMITS) {}
  snapshot() {
    return { ...this.counts };
  }
  reserve(kind: Resource, count = 1): BudgetLease {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new AppError("plugin/invalid-input", "Invalid host resource reservation");
    if (this.counts[kind] + count > this.limits[kind])
      throw new AppError("plugin/busy", "Host plugin resource capacity exceeded");
    this.counts[kind] += count;
    let remaining = count;
    return {
      release: (amount = remaining) => {
        if (!Number.isSafeInteger(amount) || amount < 0)
          throw new AppError("plugin/invalid-input", "Invalid host resource release");
        const released = Math.min(amount, remaining);
        remaining -= released;
        this.counts[kind] -= released;
      },
    };
  }
}

type Usage = { messages: number; bytes: number; entries: number };
type Rates = { burst: Usage; perSecond: Usage };
const fields = ["messages", "bytes", "entries"] as const;
/** One plugin's Worker traffic, both directions. */
export const PLUGIN_TRAFFIC_LIMITS = Object.freeze({
  burst: { messages: 16_384, bytes: 256 * 1024 * 1024, entries: 4_000_000 },
  perSecond: { messages: 4096, bytes: 64 * 1024 * 1024, entries: 1_000_000 },
});

class TrafficBucket {
  private tokens: Usage;
  private at: number;
  constructor(
    private readonly rates: Rates,
    private readonly now: () => number,
  ) {
    this.tokens = { ...rates.burst };
    this.at = now();
  }
  admit(usage: Usage) {
    const current = this.now(),
      elapsed = Math.max(0, current - this.at) / 1000;
    this.at = Math.max(current, this.at);
    for (const field of fields)
      this.tokens[field] = Math.min(
        this.rates.burst[field],
        this.tokens[field] + elapsed * this.rates.perSecond[field],
      );
    if (
      fields.some((field) => !Number.isFinite(usage[field]) || usage[field] < 0 || usage[field] > this.tokens[field])
    ) {
      throw new AppError("plugin/quota-exceeded", "Plugin transport traffic budget exceeded");
    }
    for (const field of fields) this.tokens[field] -= usage[field];
  }
}

/**
 * Bidirectional token buckets, one per plugin. A busy plugin spends only its
 * own budget, so it can never push another plugin's replies over a limit; the
 * bucket outlives a Worker, so restarting the plugin does not refill it.
 */
export class PluginTrafficBudget {
  private readonly buckets = new Map<string, TrafficBucket>();
  constructor(
    private readonly limits: Rates = PLUGIN_TRAFFIC_LIMITS,
    private readonly now = () => performance.now(),
  ) {}
  open(pluginId: string) {
    let bucket = this.buckets.get(pluginId);
    if (!bucket) this.buckets.set(pluginId, (bucket = new TrafficBucket(this.limits, this.now)));
    const charge = (usage: Usage) => bucket.admit(usage);
    return {
      // Count before graph traversal, including malformed and oversized envelopes.
      message: () => charge({ messages: 1, bytes: 0, entries: 0 }),
      graph: (usage: { bytes: number; entries: number }) => charge({ messages: 0, ...usage }),
    };
  }
}

export const pluginHostBudget = new PluginHostBudget();
export const pluginTrafficBudget = new PluginTrafficBudget();
