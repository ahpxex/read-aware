import { AppError, ERR_AI_NETWORK, ERR_AI_PROVIDER, ERR_AI_RATE_LIMITED } from "@read-aware/core";
import type { AgentFetch } from "./transport";
import { parseCatalogCache, parseCatalogModels, parseOllamaCatalog, type CatalogCache, type CatalogModel } from "./catalog-data";
import type { KnownProviderId } from "./provider-definitions";

export const MODEL_CATALOG_TTL_MS = 4 * 60 * 60 * 1_000;
export const MODEL_CATALOG_RETRY_MS = 5 * 60 * 1_000;
const EMPTY_MODELS: CatalogModel[] = [];
export type CatalogState = {
  models: readonly CatalogModel[];
  refreshing: boolean;
  checkedAt?: number;
  error?: unknown;
};
type CatalogDeps = {
  fetch: AgentFetch;
  read: (provider: KnownProviderId) => string | null;
  write: (provider: KnownProviderId, value: string) => Promise<void>;
  selected: (provider: KnownProviderId) => readonly string[];
  log: { warn: (message: string, error: unknown) => void };
  now?: () => number;
  timeoutMs?: number;
};

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) onAbort();
  });
}

/** Shared across pickers and inference. Refresh never writes the user's AI configuration. */
export class ModelCatalogStore {
  private readonly cache = new Map<KnownProviderId, CatalogCache>();
  private readonly states = new Map<KnownProviderId, CatalogState>();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<KnownProviderId, Promise<void>>();
  private readonly retryAt = new Map<KnownProviderId, number>();
  private readonly now: () => number;

  constructor(private readonly deps: CatalogDeps) {
    this.now = deps.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (provider: KnownProviderId): CatalogState => {
    let state = this.states.get(provider);
    if (state) return state;
    try {
      const raw = this.deps.read(provider);
      if (raw) this.cache.set(provider, parseCatalogCache(provider, JSON.parse(raw)));
      const cached = this.cache.get(provider);
      state = { models: cached?.models ?? EMPTY_MODELS, refreshing: false, checkedAt: cached?.checkedAt };
    } catch (error) {
      this.deps.log.warn(`Model catalog cache unreadable: ${provider}`, error);
      state = { models: EMPTY_MODELS, refreshing: false, error };
    }
    this.states.set(provider, state);
    return state;
  };

  getModels = (provider: KnownProviderId): readonly CatalogModel[] => {
    this.getSnapshot(provider);
    const cached = this.cache.get(provider);
    return cached ? [...cached.models, ...cached.retained] : EMPTY_MODELS;
  };

  private publish(provider: KnownProviderId, state: CatalogState): void {
    this.states.set(provider, state);
    for (const listener of this.listeners) listener();
  }

  refresh = (provider: KnownProviderId, force = false): Promise<void> => {
    const pending = this.pending.get(provider);
    if (pending) return pending;
    const state = this.getSnapshot(provider);
    const age = this.now() - (state.checkedAt ?? 0);
    if (!force && ((state.checkedAt !== undefined && age >= 0 && age < MODEL_CATALOG_TTL_MS) ||
      this.now() < (this.retryAt.get(provider) ?? 0))) return Promise.resolve();
    const work = this.fetchCatalog(provider).finally(() => { this.pending.delete(provider); });
    this.pending.set(provider, work);
    return work;
  };

  private async fetchCatalog(provider: KnownProviderId): Promise<void> {
    const previous = this.getSnapshot(provider);
    this.publish(provider, { ...previous, refreshing: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 12_000);
    try {
      const cached = this.cache.get(provider);
      const url = provider === "ollama-cloud"
        ? "https://ollama.com/v1/models"
        : `https://pi.dev/api/models/providers/${encodeURIComponent(provider)}`;
      // Public metadata only: API keys and reading data never go to the catalog host.
      const { response, body } = await abortable((async () => {
        const response = await this.deps.fetch(url, {
          headers: { Accept: "application/json", ...(cached?.etag ? { "If-None-Match": cached.etag } : {}) },
          signal: controller.signal,
        });
        const body: unknown = response.ok ? await response.json() : undefined;
        return { response, body };
      })(), controller.signal);
      clearTimeout(timeout);
      let next: CatalogCache;
      if (response.status === 304 && cached) {
        next = { ...cached, checkedAt: this.now() };
      } else {
        if (!response.ok) throw new AppError(
          response.status === 429 ? ERR_AI_RATE_LIMITED : ERR_AI_PROVIDER,
          `Model catalog HTTP ${response.status}: ${provider}`, { retryable: true },
        );
        const models = provider === "ollama-cloud" ? parseOllamaCatalog(body) : parseCatalogModels(provider, body);
        if (models.length === 0) throw new AppError(ERR_AI_PROVIDER, `Empty model catalog: ${provider}`, { retryable: true });
        const ids = new Set(models.map((model) => model.id));
        const selected = new Set(this.deps.selected(provider));
        const retained = this.getModels(provider).filter((model) => selected.has(model.id) && !ids.has(model.id));
        next = { version: 1, models, retained, checkedAt: this.now(), etag: response.headers.get("etag") ?? undefined };
      }
      controller.signal.throwIfAborted();
      // Publish only after durable cache replacement succeeds.
      await this.deps.write(provider, JSON.stringify(next));
      this.cache.set(provider, next);
      this.retryAt.delete(provider);
      this.publish(provider, { models: next.models, refreshing: false, checkedAt: next.checkedAt });
    } catch (cause) {
      const error = cause instanceof AppError ? cause : new AppError(ERR_AI_NETWORK, `Model catalog refresh failed: ${provider}`, { cause, retryable: true });
      this.deps.log.warn(`Keeping previous model catalog: ${provider}`, cause);
      this.retryAt.set(provider, this.now() + MODEL_CATALOG_RETRY_MS);
      this.publish(provider, { ...previous, refreshing: false, error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
