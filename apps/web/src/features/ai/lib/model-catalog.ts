import { ModelCatalogStore, setModelCatalogReader, type KnownProviderId } from "@read-aware/agent";
import { appHttpFetch } from "../../../platform/http-client";
import { localKV, replaceLocalKVPrefix } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { getAIConfig, getStoredProviderSettings, PROVIDER_LABELS } from "./ai-config";

const CACHE_PREFIX = "read-aware-model-catalog-v1:";

export const modelCatalog = new ModelCatalogStore({
  fetch: appHttpFetch,
  read: (provider) => localKV.getItem(CACHE_PREFIX + provider + ":snapshot"),
  write: (provider, value) => replaceLocalKVPrefix(CACHE_PREFIX + provider + ":", { snapshot: value }),
  selected: (provider) => {
    if (provider === "openai-codex") return [];
    const saved = getStoredProviderSettings(provider);
    return [saved.model, saved.fastModel];
  },
  log: createLogger("model-catalog"),
});

setModelCatalogReader(modelCatalog.getModels);

export function isCatalogProvider(provider: string): provider is Exclude<KnownProviderId, "openai-codex"> {
  return provider !== "custom" && provider !== "readaware" && Object.hasOwn(PROVIDER_LABELS, provider);
}

/** Check active/previously cached providers at startup, on wake, and periodically. */
export function startModelCatalogRefresh(): () => void {
  const check = () => {
    const active = getAIConfig()?.provider;
    for (const provider of Object.keys(PROVIDER_LABELS)) {
      if (!isCatalogProvider(provider)) continue;
      if (provider === active || modelCatalog.getSnapshot(provider).checkedAt !== undefined) {
        void modelCatalog.refresh(provider);
      }
    }
  };
  const wake = () => { if (document.visibilityState === "visible") check(); };
  check();
  const timer = window.setInterval(check, 60_000);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", wake);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", wake);
  };
}

if (import.meta.hot) import.meta.hot.dispose(() => setModelCatalogReader(() => []));
