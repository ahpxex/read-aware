import { AppError, errorCode, validateSettingsOptionsQuery, type ModelCatalogPage, type ModelCatalogQuery } from "@read-aware/core";
import type { CatalogState } from "@read-aware/agent";
import { isCatalogProvider, modelCatalog } from "../../features/ai/lib/model-catalog";

const revisions = new WeakMap<CatalogState, number>();
let revision = 0;

function providerId(value: unknown) {
  if (typeof value !== "string" || !isCatalogProvider(value)) {
    throw new AppError("settings/options-invalid", "Choose a supported public catalog provider");
  }
  return value;
}

/** Only public discovery rows, not retained selected models, headers or endpoints. */
export function queryModelCatalog(input: ModelCatalogQuery): ModelCatalogPage {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["provider", "search", "offset", "limit", "revision"].includes(key))) {
    throw new AppError("settings/options-invalid", "Invalid model catalog query");
  }
  const provider = providerId(input.provider);
  const query = validateSettingsOptionsQuery({ ...input, path: "ai.connection.primaryModel" });
  const state = modelCatalog.getSnapshot(provider);
  let current = revisions.get(state);
  if (current === undefined) { current = ++revision; revisions.set(state, current); }
  if (query.revision !== undefined && query.revision !== current) throw new AppError("settings/options-stale", "Model catalog changed; restart paging");
  const search = query.search.toLocaleLowerCase();
  const filtered = state.models.filter(model => !search || `${model.id} ${model.name}`.toLocaleLowerCase().includes(search));
  const end = Math.min(filtered.length, query.offset + query.limit);
  return {
    provider, revision: current, refreshing: state.refreshing, checkedAt: state.checkedAt ?? null,
    errorCode: state.error ? errorCode(state.error) ?? "ai/provider" : null,
    models: filtered.slice(query.offset, end).map(model => ({ id: model.id, name: model.name, reasoning: model.reasoning,
      input: [...model.input], contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens })),
    total: filtered.length, offset: query.offset, nextOffset: end < filtered.length ? end : null,
  };
}

export async function refreshModelCatalog(provider: string, signal?: AbortSignal): Promise<ModelCatalogPage> {
  const accepted = providerId(provider);
  signal?.throwIfAborted();
  await modelCatalog.refresh(accepted, true);
  signal?.throwIfAborted();
  const result = queryModelCatalog({ provider: accepted });
  // The native picker retains stale rows on failure; an explicit command must
  // still reject instead of claiming those rows are a successful refresh.
  if (result.errorCode) throw new AppError(result.errorCode, "Model catalog refresh failed");
  return result;
}
