/**
 * Bundled-AI proxy internals: the model catalog, the credit math, and the
 * SSE usage meter. The relay stays a dumb METERED relay here — it forwards
 * OpenAI-compatible requests to the configured upstream, injects the
 * operator's key, and reads the usage numbers off the response. It never
 * logs, stores, or interprets request/response content (unlike sync data,
 * these requests are NOT E2E — plaintext inside TLS — which is exactly why
 * nothing but token counts may ever touch storage).
 *
 * Billing rates are OUR rates, fixed per model in code at the upstream's
 * peak price — off-peak upstream hours are margin, and a rate change is a
 * deploy, never a data migration (same philosophy as quotasForTier).
 */

/** 1 credit = $0.001. Wire and UI speak credits; storage speaks micro-USD. */
export const MICRO_USD_PER_CREDIT = 1000;

export type AiModel = {
  /** Client-facing id (== upstream id today; the seam allows divergence). */
  id: string;
  name: string;
  upstreamBaseUrl: string;
  upstreamModel: string;
  apiKey: string;
  /** Our billing rates, micro-USD per 1M tokens. */
  inputMicroUsdPerMTok: number;
  cacheHitMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
};

/**
 * DeepSeek: the first-class citizen of the bundled subscription. Rates are
 * the published PEAK prices (2026-08); flash first — its position makes it
 * the catalog default.
 */
export function deepseekModels(apiKey: string): AiModel[] {
  const base = "https://api.deepseek.com";
  return [
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      upstreamBaseUrl: base,
      upstreamModel: "deepseek-v4-flash",
      apiKey,
      inputMicroUsdPerMTok: 440_000, // $0.44 / MTok
      cacheHitMicroUsdPerMTok: 14_000, // $0.014 / MTok
      outputMicroUsdPerMTok: 1_320_000, // $1.32 / MTok
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      upstreamBaseUrl: base,
      upstreamModel: "deepseek-v4-pro",
      apiKey,
      inputMicroUsdPerMTok: 1_320_000, // $1.32 / MTok
      cacheHitMicroUsdPerMTok: 44_000, // $0.044 / MTok
      outputMicroUsdPerMTok: 3_960_000, // $3.96 / MTok
    },
  ];
}

export type AiUsage = {
  /** Prompt tokens NOT served from the upstream's prefix cache. */
  cacheMissTokens: number;
  cacheHitTokens: number;
  completionTokens: number;
};

/**
 * Read usage off an OpenAI-compatible `usage` object. DeepSeek reports the
 * cache split as `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`;
 * generic OpenAI-compat reports `prompt_tokens_details.cached_tokens`. When
 * neither is present every prompt token bills at the cache-miss rate — the
 * conservative direction.
 */
export function usageFromOpenAI(value: unknown): AiUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const u = value as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  if (prompt === null || completion === null) return null;
  const details =
    typeof u.prompt_tokens_details === "object" && u.prompt_tokens_details !== null
      ? (u.prompt_tokens_details as Record<string, unknown>)
      : {};
  const hit = num(u.prompt_cache_hit_tokens) ?? num(details.cached_tokens) ?? 0;
  const miss = num(u.prompt_cache_miss_tokens) ?? Math.max(0, prompt - hit);
  return { cacheMissTokens: miss, cacheHitTokens: hit, completionTokens: completion };
}

/** Whole micro-USD, rounded up — the meter never under-charges fractions. */
export function costMicroUsd(model: AiModel, usage: AiUsage): number {
  const raw =
    usage.cacheMissTokens * model.inputMicroUsdPerMTok +
    usage.cacheHitTokens * model.cacheHitMicroUsdPerMTok +
    usage.completionTokens * model.outputMicroUsdPerMTok;
  return Math.ceil(raw / 1_000_000);
}

export const creditsFromMicroUsd = (microUsd: number): number =>
  Math.ceil(microUsd / MICRO_USD_PER_CREDIT);

/**
 * A byte-transparent SSE tap: forwards every chunk untouched while scanning
 * `data:` lines for the final chunk that carries `usage` (the proxy forces
 * `stream_options.include_usage`). The last usage seen wins; `onUsage` fires
 * once at stream end, after which the accounting write races nothing.
 */
export function meterSseStream(onUsage: (usage: AiUsage) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let last: AiUsage | null = null;

  const scan = (text: string, isFlush: boolean) => {
    buffer += text;
    const lines = buffer.split("\n");
    // The final element is a partial line — keep it unless flushing.
    buffer = isFlush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : null;
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { usage?: unknown };
        const usage = usageFromOpenAI(parsed.usage);
        if (usage) last = usage;
      } catch {
        // Partial or non-JSON data line: not ours to judge — pass through.
      }
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      scan(decoder.decode(chunk, { stream: true }), false);
    },
    flush() {
      scan(decoder.decode(), true);
      if (last) onUsage(last);
    },
  });
}

/** UTC month key for the usage row, e.g. "2026-08". */
export const monthKey = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 7);
