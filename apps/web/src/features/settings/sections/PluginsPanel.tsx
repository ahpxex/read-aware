/**
 * Settings → Plugins: Installed / Marketplace tabs. The active tab's primary
 * action (install from folder, refresh registry) sits on the tab strip's
 * trailing edge; both lists are searchable. Arrangement moved to the Menus
 * settings page (docs/plugin-system.md §7).
 */
import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAtomValue } from "jotai";
import { Badge, Button, Caption, Tabs, Toggle, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { PluginMarketplace } from "../../plugins/components/PluginMarketplace";
import { PluginSearchInput } from "../../plugins/components/PluginSearchInput";
import { parseManifestJson } from "../../plugins/lib/manifest";
import { buildPluginSettingsView } from "../../plugins/lib/plugin-settings";
import { matchesPluginQuery } from "../../plugins/lib/search";
import { permissionLabelKey, type PluginPermission } from "../../plugins/lib/plugin-types";
import { readPluginManifestFromDir } from "../../plugins/runtime/plugin-backend";
import {
  installPlugin,
  setPluginEnabled,
  uninstallPlugin,
} from "../../plugins/runtime/plugin-host";
import {
  installedPluginsAtom,
  openPluginDialog,
  requestInstallConsent,
} from "../../plugins/state/plugin-store";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PluginsPanel() {
  const { t } = useTranslation("plugins");
  const { toast } = useToast();
  const installed = useAtomValue(installedPluginsAtom);
  const [activeTab, setActiveTab] = useState(0);
  const [installedQuery, setInstalledQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);
  const [marketRefreshToken, setMarketRefreshToken] = useState(0);
  const desktop = isTauri();

  async function handleInstall() {
    setInstalling(true);
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) {
        // Consent before any copy: read + validate the manifest in place.
        const manifest = parseManifestJson(await readPluginManifestFromDir(picked));
        if (!(await requestInstallConsent(manifest))) return;
        const plugin = await installPlugin(picked);
        toast({
          description: t("settings.installedToast", { name: plugin.manifest.name }),
          variant: "success",
        });
      }
    } catch (error) {
      toast({
        description: t("settings.installFailed", { message: errorMessage(error) }),
        variant: "destructive",
      });
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall(id: string) {
    if (confirmingUninstall !== id) {
      setConfirmingUninstall(id);
      return;
    }
    setConfirmingUninstall(null);
    try {
      await uninstallPlugin(id);
    } catch (error) {
      toast({ description: errorMessage(error), variant: "destructive" });
    }
  }

  const filteredInstalled = installed.filter((plugin) =>
    matchesPluginQuery(
      installedQuery,
      plugin.manifest.name,
      plugin.manifest.id,
      plugin.manifest.description,
      plugin.manifest.author,
    ),
  );

  const installedTab = (
    <>
      <PluginSearchInput
        value={installedQuery}
        onChange={setInstalledQuery}
        placeholder={t("settings.searchPlaceholder")}
      />

      <div className="mt-1">
        {installed.length === 0 ? (
          <Caption className="block py-4 text-fg-subtle">{t("settings.empty")}</Caption>
        ) : filteredInstalled.length === 0 ? (
          <Caption className="block py-4 text-fg-subtle">{t("settings.noMatches")}</Caption>
        ) : (
          filteredInstalled.map((plugin, index) => {
            const { manifest } = plugin;
            const permissions = manifest.permissions ?? [];
            return (
              <SettingsRow
                key={manifest.id}
                borderless={index === 0}
                title={
                  <span className="flex items-center gap-2">
                    <span>{manifest.name}</span>
                    <Caption className="text-fg-subtle">v{manifest.version}</Caption>
                  </span>
                }
                description={
                  <span className="flex flex-col gap-1.5">
                    {manifest.description && <span>{manifest.description}</span>}
                    <span className="flex flex-wrap items-center gap-1">
                      {permissions.length === 0 ? (
                        <Caption className="text-fg-subtle">
                          {t("settings.noPermissions")}
                        </Caption>
                      ) : (
                        permissions.map((permission: PluginPermission) => (
                          <Badge key={permission} className="text-[11px]">
                            {t(permissionLabelKey(permission) as never)}
                          </Badge>
                        ))
                      )}
                    </span>
                    {plugin.error && (
                      <span className="text-xs text-red-700 dark:text-red-400">
                        {t("settings.activationError", { message: plugin.error })}
                      </span>
                    )}
                  </span>
                }
                control={
                  <span className="flex shrink-0 items-center gap-2">
                    {manifest.settings && manifest.settings.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const view = buildPluginSettingsView(
                            manifest,
                            t("settings.configureSave"),
                            t("settings.configureSaved"),
                          );
                          if (view) {
                            openPluginDialog({
                              pluginId: manifest.id,
                              pluginName: manifest.name,
                              view,
                            });
                          }
                        }}
                      >
                        {t("settings.configure")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={confirmingUninstall === manifest.id ? "danger" : "ghost"}
                      onClick={() => void handleUninstall(manifest.id)}
                      onBlur={() => setConfirmingUninstall(null)}
                    >
                      {confirmingUninstall === manifest.id
                        ? t("settings.uninstallConfirmShort")
                        : t("settings.uninstall")}
                    </Button>
                    <Toggle
                      aria-label={t("settings.enabled")}
                      checked={plugin.enabled}
                      onChange={(enabled) => void setPluginEnabled(manifest.id, enabled)}
                    />
                  </span>
                }
              />
            );
          })
        )}
      </div>

    </>
  );

  return (
    <SettingsPage title={t("settings.title")} description={t("settings.trustWarning")}>
      <Tabs
        ariaLabel={t("settings.title")}
        activeIndex={activeTab}
        onActiveIndexChange={setActiveTab}
        trailing={
          activeTab === 0 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!desktop || installing}
              onClick={() => void handleInstall()}
            >
              {installing ? t("settings.installing") : t("settings.install")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMarketRefreshToken((token) => token + 1)}
            >
              {t("settings.refresh")}
            </Button>
          )
        }
        items={[
          { label: t("settings.tabInstalled"), content: installedTab },
          {
            label: t("settings.tabMarketplace"),
            content: <PluginMarketplace refreshToken={marketRefreshToken} />,
          },
        ]}
      />
    </SettingsPage>
  );
}
