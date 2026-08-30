/**
 * The marketplace list as pure presentation.
 *
 * Split out of `PluginMarketplace` so the registry fetch, the consent gate and
 * the install call stay in the container: this half takes a load state and a
 * handful of callbacks, which is what lets every state it can be in — loading,
 * error, empty registry, no search matches, installed, update available,
 * bundled, installing — be rendered and reviewed on its own.
 */
import { Badge, Button, Caption, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { matchesPluginQuery } from "../lib/search";
import { MARKETPLACE_REPO, type MarketplaceEntry } from "../runtime/marketplace";
import { permissionNameKey, type InstalledPlugin } from "../lib/plugin-types";
import { PluginSearchInput } from "./PluginSearchInput";

export type MarketplaceLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; entries: MarketplaceEntry[] };

type PluginMarketplaceViewProps = {
  state: MarketplaceLoadState;
  /** What is already installed, for the installed / update / bundled labels. */
  installed: InstalledPlugin[];
  /** The entry currently installing, or null. */
  busyId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** Installing needs the desktop shell; elsewhere the action is disabled. */
  desktop: boolean;
  onRetry: () => void;
  onInstall: (entry: MarketplaceEntry) => void;
};

export function PluginMarketplaceView({
  state,
  installed,
  busyId,
  query,
  onQueryChange,
  desktop,
  onRetry,
  onInstall,
}: PluginMarketplaceViewProps) {
  const { t } = useTranslation("plugins");

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
        <Caption className="text-fg-muted">{t("settings.marketplaceError")}</Caption>
        <Button size="sm" variant="outline" onClick={onRetry}>
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
        onChange={onQueryChange}
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
        // A registry entry colliding with a bundled plugin must never offer
        // install/update: the built-in cannot be uninstalled, and installing
        // would plant a second same-id plugin beside it.
        const builtin = installedPlugin?.builtin === true;
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
                    {t(permissionNameKey(permission) as never)}
                  </Badge>
                ))}
              </span>
            </div>
            <div className="shrink-0 pt-0.5">
              {builtin ? (
                <Caption className="text-fg-subtle">{t("settings.builtin")}</Caption>
              ) : installedPlugin && upToDate ? (
                <Caption className="text-fg-subtle">{t("settings.installedBadge")}</Caption>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!desktop || busyId !== null}
                  onClick={() => onInstall(entry)}
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
