import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CatalogState, KnownProviderId } from "@read-aware/agent";
import { isCatalogProvider, modelCatalog } from "../../ai/lib/model-catalog";

const EMPTY: CatalogState = { models: [], refreshing: false };

export function useModelCatalog(provider: string) {
  const supported = isCatalogProvider(provider);
  const getSnapshot = useCallback(
    () => supported ? modelCatalog.getSnapshot(provider as KnownProviderId) : EMPTY,
    [provider, supported],
  );
  const state = useSyncExternalStore(modelCatalog.subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (supported) void modelCatalog.refresh(provider as KnownProviderId);
  }, [provider, supported]);
  const refresh = useCallback(() => {
    if (supported) void modelCatalog.refresh(provider as KnownProviderId, true);
  }, [provider, supported]);
  return { ...state, refresh };
}
