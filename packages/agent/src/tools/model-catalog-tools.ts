import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { ModelCatalogPage, ModelCatalogQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

const catalogResult = (page: ModelCatalogPage) => textResult({ ...page,
  checkedAt: page.checkedAt === null ? null : new Date(page.checkedAt).toISOString() });

export function buildModelCatalogTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_model_catalog", label: "Model catalog",
    description: "Read cached public model metadata for an explicit known provider. No network or credentials, endpoints, current choices, billing rates or retained selected models. Returns input types, reasoning support, context window and output limit from discovery metadata, not a successful connection test. Preserve provider/search/revision for later pages; a changed revision requires restarting. errorCode with older rows is stale data, never a successful fresh lookup. Custom, ReadAware relay and Codex catalogs are unsupported.",
    parameters: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 256 }),
      search: Type.Optional(Type.String({ maxLength: 120 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), revision: Type.Optional(Type.Integer({ minimum: 0 })),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.settings.getModelCatalog(params as ModelCatalogQuery);
      signal?.throwIfAborted(); return catalogResult(result);
    },
  }, {
    name: "refresh_model_catalog", label: "Refresh model catalog", executionMode: "sequential",
    description: "Only on explicit user request, refresh a known provider's public model catalog using the native host's fixed discovery endpoint/cache. Shares existing in-flight refreshes, never uses API keys, changes configuration or runs inference. Returns first 25 metadata rows after success; failures reject, old cache remains available via get_model_catalog. Cancellation stops this caller's wait, not another caller's shared refresh or an accepted cache write. This is not a connection test. Custom, ReadAware relay and Codex catalogs are unsupported.",
    parameters: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.settings.refreshModelCatalog((params as { provider: string }).provider, signal);
      signal?.throwIfAborted(); return catalogResult(result);
    },
  }];
}
