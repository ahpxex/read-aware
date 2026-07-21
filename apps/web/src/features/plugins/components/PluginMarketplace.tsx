/**
 * The marketplace browser (settings → Plugins → Marketplace): lists the
 * community registry, installs/updates with one click. Community plugins land
 * in the registry repo via pull request (Raycast model) — this surface only
 * reads it.
 */
import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Badge, Button, Caption, Spinner, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { matchesPluginQuery } from "../lib/search";
import {
  MARKETPLACE_REPO,
  fetchMarketplaceRegistry,
  installFromMarketplace,
  type MarketplaceEntry,
} from "../runtime/marketplace";
import { installedPluginsAtom } from "../state/plugin-store";
import { PluginSearchInput } from "./PluginSearchInput";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: MarketplaceEntry[] };

type PluginMarketplaceProps = {
  /** Bumped by the hosting panel's Refresh action to re-fetch the registry. */
  refreshToken?: number;
};

export function PluginMarketplace({ refreshToken = 0 }: PluginMarketplaceProps) {
  const { t } = useTranslation("plugins");
  const { toast } = useToast();
  const installed = useAtomValue(installedPluginsAtom);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const desktop = isTauri();

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", entries: await fetchMarketplaceRegistry() });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function handleInstall(entry: MarketplaceEntry) {
    setBusyId(entry.id);
    try {
      const plugin = await installFromMarketplace(entry);
      toast({
        description: t("settings.installedToast", { name: plugin.manifest.name }),
        variant: "success",
      });
    } catch (error) {
      toast({
        description: t("settings.installFailed", { message: errorMessage(error) }),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="sm" label={t("viewer.loading")} />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        <Caption className="text-fg-muted">
          {t("settings.marketplaceError", { message: state.message })}
        </Caption>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t("settings.retry")}
        </Button>
      </div>
    );
  }

  const filtered = state.entries.filter((entry) =>
    matchesPluginQuery(query, entry.name, entry.id, entry.description, entry.author),
  );

  return (
    <div className="flex flex-col">
      <PluginSearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("settings.searchPlaceholder")}
        className="mb-3"
      />

      {state.entries.length === 0 ? (
        <Caption className="py-6 text-fg-subtle">{t("settings.marketplaceEmpty")}</Caption>
      ) : filtered.length === 0 ? (
        <Caption className="py-6 text-fg-subtle">{t("settings.noMatches")}</Caption>
      ) : null}

      {filtered.map((entry) => {
        const installedPlugin = installed.find((p) => p.manifest.id === entry.id);
        const upToDate = installedPlugin?.manifest.version === entry.version;
        return (
          <div
            key={entry.id}
            className="flex items-start justify-between gap-6 border-t border-border py-3.5 first:border-t-0"
          >
            <div className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="font-sans text-sm font-medium text-fg">{entry.name}</span>
                <Caption className="text-fg-subtle">v{entry.version}</Caption>
                {entry.author && <Caption className="text-fg-subtle">{entry.author}</Caption>}
              </span>
              {entry.description && (
                <p className="mt-0.5 font-sans text-sm text-fg-muted">{entry.description}</p>
              )}
              <span className="mt-1.5 flex flex-wrap items-center gap-1">
                {(entry.permissions ?? []).map((permission) => (
                  <Badge key={permission} className="text-[11px]">
                    {t(`settings.permission.${permission}`)}
                  </Badge>
                ))}
              </span>
            </div>
            <div className="shrink-0 pt-0.5">
              {installedPlugin && upToDate ? (
                <Caption className="text-fg-subtle">{t("settings.installedBadge")}</Caption>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!desktop || busyId !== null}
                  onClick={() => void handleInstall(entry)}
                >
                  {busyId === entry.id
                    ? t("settings.installing")
                    : installedPlugin
                      ? t("settings.update")
                      : t("settings.installFromMarketplace")}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <Caption className="border-t border-border pt-3 text-fg-subtle">
        {t("settings.marketplaceHint")} <code className="text-[11px]">{MARKETPLACE_REPO}</code>
      </Caption>
    </div>
  );
}
