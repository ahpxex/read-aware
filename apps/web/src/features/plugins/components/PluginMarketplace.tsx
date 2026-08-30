/**
 * The marketplace browser (settings → Plugins → Marketplace): lists the
 * community registry, installs/updates with one click. Community plugins land
 * in the registry repo via pull request (Raycast model) — this surface only
 * reads it.
 *
 * This half owns the effects — fetching the registry, the consent gate, the
 * install call and its toasts. The rendering lives in `PluginMarketplaceView`.
 */
import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import {
  fetchMarketplaceRegistry,
  prepareMarketplaceInstall,
  type MarketplaceEntry,
} from "../runtime/marketplace";
import { installedPluginsAtom, requestInstallConsent } from "../state/plugin-store";
import {
  PluginMarketplaceView,
  type MarketplaceLoadState,
} from "./PluginMarketplaceView";

const log = createLogger("plugins");

type PluginMarketplaceProps = {
  /** Bumped by the hosting panel's Refresh action to re-fetch the registry. */
  refreshToken?: number;
};

export function PluginMarketplace({ refreshToken = 0 }: PluginMarketplaceProps) {
  const { t } = useTranslation("plugins");
  const { toast } = useToast();
  const installed = useAtomValue(installedPluginsAtom);
  const [state, setState] = useState<MarketplaceLoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", entries: await fetchMarketplaceRegistry() });
    } catch (error) {
      log.error("marketplace registry fetch failed", error);
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function handleInstall(entry: MarketplaceEntry) {
    setBusyId(entry.id);
    try {
      const { manifest, complete } = await prepareMarketplaceInstall(entry);
      if (!(await requestInstallConsent(manifest))) return;
      const plugin = await complete();
      toast({
        description: t("settings.installedToast", { name: plugin.manifest.name }),
        variant: "success",
      });
    } catch (error) {
      log.error("marketplace install failed", error);
      toast({ description: t("settings.installFailed"), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PluginMarketplaceView
      state={state}
      installed={installed}
      busyId={busyId}
      query={query}
      onQueryChange={setQuery}
      desktop={isTauri()}
      onRetry={() => void load()}
      onInstall={(entry) => void handleInstall(entry)}
    />
  );
}
