/**
 * Settings → Plugins: install (folder picker), enable/disable, permission
 * display, uninstall, and the user-owned placement controls (which actions are
 * pinned to which surface — docs/plugin-system.md §7). The trust warning is
 * the page description: installation is the security boundary (§2).
 */
import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { Badge, Button, Caption, Toggle, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import type { PluginPermission } from "../../plugins/lib/plugin-types";
import {
  installPlugin,
  setPluginEnabled,
  uninstallPlugin,
} from "../../plugins/runtime/plugin-host";
import {
  HEADER_PIN_LIMIT,
  SELECTION_PIN_LIMIT,
  headerActionsAtom,
  installedPluginsAtom,
  pluginPlacementAtom,
  selectionActionsAtom,
  type PluginPlacement,
} from "../../plugins/state/plugin-store";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PluginsPanel() {
  const { t } = useTranslation("plugins");
  const { toast } = useToast();
  const installed = useAtomValue(installedPluginsAtom);
  const headerActions = useAtomValue(headerActionsAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const [placement, setPlacement] = useAtom(pluginPlacementAtom);
  const [installing, setInstalling] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);
  const desktop = isTauri();

  async function handleInstall() {
    setInstalling(true);
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) {
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

  function togglePin(surface: keyof PluginPlacement, key: string, limit: number) {
    const current = placement[surface];
    if (current.includes(key)) {
      setPlacement({ ...placement, [surface]: current.filter((entry) => entry !== key) });
    } else if (current.length >= limit) {
      toast({ description: t("settings.pinLimit", { count: limit }) });
    } else {
      setPlacement({ ...placement, [surface]: [...current, key] });
    }
  }

  const placementSections: {
    surface: keyof PluginPlacement;
    limit: number;
    items: { key: string; title: string; icon?: string; pluginName: string }[];
  }[] = [
    {
      surface: "shelfHeader",
      limit: HEADER_PIN_LIMIT,
      items: headerActions.filter((action) => action.surface === "shelf"),
    },
    {
      surface: "readerHeader",
      limit: HEADER_PIN_LIMIT,
      items: headerActions.filter((action) => action.surface === "reader"),
    },
    { surface: "selection", limit: SELECTION_PIN_LIMIT, items: selectionActions },
  ];
  const hasPlacementItems = placementSections.some((section) => section.items.length > 0);

  return (
    <SettingsPage title={t("settings.title")} description={t("settings.trustWarning")}>
      <SettingsGroup title={t("settings.title")}>
        <div className="flex items-center justify-between gap-4 pb-3">
          <Caption className="text-fg-subtle">
            {installed.length === 0 ? t("settings.empty") : null}
          </Caption>
          <Button
            size="sm"
            variant="outline"
            disabled={!desktop || installing}
            onClick={() => void handleInstall()}
          >
            {installing ? t("settings.installing") : t("settings.install")}
          </Button>
        </div>

        {installed.map((plugin, index) => {
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
                          {t(`settings.permission.${permission}`)}
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
        })}
      </SettingsGroup>

      {hasPlacementItems && (
        <SettingsGroup
          title={t("settings.placement")}
          description={t("settings.placementHint")}
        >
          {placementSections.map((section) =>
            section.items.length === 0 ? null : (
              <div key={section.surface} className="border-t border-border py-3 first:border-t-0">
                <Caption className="text-fg-subtle">
                  {t(`settings.surface.${section.surface}`)}
                </Caption>
                <div className="mt-2 flex flex-col gap-1.5">
                  {section.items.map((item) => {
                    const pinned = placement[section.surface].includes(item.key);
                    return (
                      <div key={item.key} className="flex items-center gap-2.5">
                        <span className="text-fg-muted">{renderPluginIcon(item.icon, 15)}</span>
                        <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">
                          {item.title}
                          <Caption className="ml-2 inline text-fg-subtle">
                            {item.pluginName}
                          </Caption>
                        </span>
                        <Button
                          size="sm"
                          variant={pinned ? "solid" : "outline"}
                          onClick={() => togglePin(section.surface, item.key, section.limit)}
                        >
                          {pinned ? t("settings.unpin") : t("settings.pin")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ),
          )}
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
