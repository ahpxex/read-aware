import type { AgentRuntime, OneShotInput } from "@read-aware/agent";
import { AppError, ERR_AI_BUSY, ERR_AI_REQUEST_CANCELLED, ERR_AI_REQUEST_TIMEOUT, ERR_PLUGIN_INVALID_ARGUMENT } from "@read-aware/core";
import type { PluginHostServices } from "@read-aware/plugin-types";
import { AiNotConfiguredError } from "../../ai/lib/ai-errors";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const LIMITS = { defaultTimeoutMs: 60_000, maxTimeoutMs: 110_000, perPluginLimit: 2, appLimit: 8, maxOutputTokensLimit: 65_536 };
const log = createLogger("plugin-llm");
type Input = Omit<OneShotInput, "trackSource"> & { timeoutMs?: number };

export class PluginInferenceSlots {
  private total = 0;
  private readonly owners = new Map<string, number>();
  acquire(pluginId: string): () => void {
    const owned = this.owners.get(pluginId) ?? 0;
    if (owned >= LIMITS.perPluginLimit || this.total >= LIMITS.appLimit) {
      throw new AppError(ERR_AI_BUSY, "Plugin inference capacity is occupied", { retryable: true });
    }
    this.total++;
    this.owners.set(pluginId, owned + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const remaining = this.owners.get(pluginId)! - 1;
      if (remaining) this.owners.set(pluginId, remaining);
      else this.owners.delete(pluginId);
    };
  }
}
const slots = new PluginInferenceSlots();

function normalize(input: Input): Input {
  const invalid = (): never => { throw new AppError(ERR_PLUGIN_INVALID_ARGUMENT, "Invalid plugin inference request"); };
  if (!input || typeof input !== "object" || typeof input.prompt !== "string") return invalid();
  if (input.system !== undefined && typeof input.system !== "string") return invalid();
  if (input.model !== undefined && input.model !== "fast" && input.model !== "smart") return invalid();
  if (input.schema !== undefined && (!input.schema || typeof input.schema !== "object" || Array.isArray(input.schema))) return invalid();
  if (input.onText !== undefined && typeof input.onText !== "function") return invalid();
  if (input.schema && input.onText) return invalid();
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) return invalid();
  if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > LIMITS.maxOutputTokensLimit)) return invalid();
  const timeoutMs = input.timeoutMs ?? LIMITS.defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.maxTimeoutMs) return invalid();
  return { prompt: input.prompt, system: input.system, model: input.model ?? "fast", timeoutMs, signal: input.signal,
    maxOutputTokens: input.maxOutputTokens,
    schema: input.schema === undefined ? undefined : structuredClone(input.schema),
    readingContext: input.readingContext === undefined ? undefined : structuredClone(input.readingContext), onText: input.onText };
}

export function createPluginLlm(
  pluginId: string,
  lifecycle: PluginLifecycleController,
  getRuntime: () => Pick<AgentRuntime, "ask" | "askDetailed"> | null,
  capacity = slots,
): NonNullable<PluginHostServices["llm"]> {
  const run = async (raw: Input, detailed: boolean): Promise<unknown> => {
    lifecycle.assertActive(detailed ? "services.llm.askDetailed" : "services.llm.ask");
    const input = normalize(raw);
    if (input.signal?.aborted) throw new AppError(ERR_AI_REQUEST_CANCELLED, "Plugin inference was cancelled before dispatch");
    const runtime = getRuntime();
    if (!runtime) throw new AiNotConfiguredError();
    const release = capacity.acquire(pluginId);
    const controller = new AbortController();
    const external = AbortSignal.any([lifecycle.signal, ...(input.signal ? [input.signal] : [])]);
    const cancel = () => controller.abort(new AppError(ERR_AI_REQUEST_CANCELLED, "Plugin inference was cancelled"));
    external.addEventListener("abort", cancel, { once: true });
    if (external.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new AppError(ERR_AI_REQUEST_TIMEOUT, "Plugin inference deadline exceeded")), input.timeoutMs);
    const sources = new Set<Promise<unknown>>();
    const trackSource = (source: Promise<unknown>) => {
      sources.add(source);
      void source.then(() => sources.delete(source), error => {
        sources.delete(source);
        if (controller.signal.aborted && error !== controller.signal.reason && !(error instanceof Error && error.name === "AbortError")) {
          log.warn("Provider source failed after plugin inference cancellation", error);
        }
      });
    };
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      const base = { prompt: input.prompt, system: input.system, model: input.model,
        readingContext: input.readingContext, signal: controller.signal, trackSource, maxOutputTokens: input.maxOutputTokens };
      if (detailed) return input.schema ? runtime.askDetailed({ ...base, schema: input.schema }) : runtime.askDetailed({ ...base, onText: input.onText });
      return input.schema ? runtime.ask({ ...base, schema: input.schema }) : runtime.ask({ ...base, onText: input.onText });
    }).catch(error => {
      controller.abort(error);
      throw error;
    });
    // Caller cancellation is prompt. Capacity and retirement still wait for the
    // original provider source, even if the policy wrapper has already rejected.
    const cleanup = (async () => {
      await Promise.allSettled([work]);
      while (sources.size) await Promise.allSettled([...sources]);
    })().finally(() => {
      clearTimeout(timer);
      external.removeEventListener("abort", cancel);
      release();
    });
    lifecycle.trackCleanup(cleanup);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      const value = await Promise.race([work, aborted]);
      controller.signal.throwIfAborted();
      return value;
    } finally { controller.signal.removeEventListener("abort", onAbort); }
  };
  return { ask: (input: Input) => run(input, false), askDetailed: (input: Input) => run(input, true),
    policy: async () => { lifecycle.assertActive("services.llm.policy"); return { ...LIMITS }; } } as NonNullable<PluginHostServices["llm"]>;
}
