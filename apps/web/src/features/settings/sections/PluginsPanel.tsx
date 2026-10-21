/**
 * Settings → Plugins: Installed / Marketplace tabs. The active tab's primary
 * action (install from folder, refresh registry) sits on the tab strip's
 * trailing edge; both lists are searchable. Arrangement moved to the Menus
 * settings page (docs/plugins/plugin-system.md §7).
 */
import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useSetAtom } from "jotai";
import { Badge, Button, Caption, Tabs, Toggle, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { settingsSectionRequestAtom } from "../../../state/ui";
import { libraryBooksAtom } from "../../library/state/library-store";
import { PluginBookAccessDialog } from "../../plugins/components/PluginBookAccessDialog";
import { PluginMarketplace } from "../../plugins/components/PluginMarketplace";
import { PluginSearchInput } from "../../plugins/components/PluginSearchInput";
import { matchesPluginQuery } from "../../plugins/lib/search";
import { permissionNameKey, type PluginBookAccess, type PluginPermission } from "../../plugins/lib/plugin-types";
import {
  preparePluginInstall,
  preparePluginZipInstall,
  setPluginEnabled,
  updatePluginBookAccess,
  uninstallPlugin,
} from "../../plugins/runtime/plugin-host";
import { installedPluginsAtom, pluginSettingsPagesAtom, requestInstallConsent } from "../../plugins/state/plugin-store";
import { createLogger } from "../../../platform/logger";
import { PluginActivationError, describePluginInstallFailure, useOutdatedPluginUpdates } from "../../plugins";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";

const log = createLogger("plugins");

export function PluginsPanel() {
  const headingRef = useMaintenanceSurface("plugins");
  const { t } = useTranslation(["plugins", "common"]);
  const { toast } = useToast();
  const installed = useAtomValue(installedPluginsAtom);
  const pluginPages = useAtomValue(pluginSettingsPagesAtom);
  const libraryBooks = useAtomValue(libraryBooksAtom);
  const setSectionRequest = useSetAtom(settingsSectionRequestAtom);
  const [activeTab, setActiveTab] = useState(0);
  const [installedQuery, setInstalledQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);
  const [editingBookAccessId, setEditingBookAccessId] = useState<string | null>(null);
  const [marketRefreshToken, setMarketRefreshToken] = useState(0);
  const desktop = isTauri();
  const books = libraryBooks.map(({ id, title }) => ({ id, title }));
  const updateOffer = useOutdatedPluginUpdates(installed, books, { enabled: desktop });

  async function handleInstall() {
    setInstalling(true);
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) {
        const candidate = await preparePluginInstall(picked);
        try {
          const consent = await requestInstallConsent(candidate.manifest, undefined, books);
          if (!consent.approved) {
            await candidate.discard();
            return;
          }
          const plugin = await candidate.complete(consent.grant);
          toast({
            description: t("settings.installedToast", { name: plugin.manifest.name }),
            variant: "success",
          });
        } catch (error) {
          await candidate
            .discard()
            .catch((cleanup) => log.warn("plugin candidate discard failed after install failure", cleanup));
          throw error;
        }
      }
    } catch (error) {
      log.error("plugin install failed", error);
      toast({ description: describePluginInstallFailure(error), variant: "destructive" });
    } finally {
      setInstalling(false);
    }
  }

  async function handleInstallZip() {
    setInstalling(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "Plugin archive", extensions: ["zip"] }],
      });
      if (typeof picked === "string" && picked) {
        const candidate = await preparePluginZipInstall(picked);
        try {
          const consent = await requestInstallConsent(candidate.manifest, undefined, books);
          if (!consent.approved) {
            await candidate.discard();
            return;
          }
          const plugin = await candidate.complete(consent.grant);
          toast({
            description: t("settings.installedToast", { name: plugin.manifest.name }),
            variant: "success",
          });
        } catch (error) {
          await candidate
            .discard()
            .catch((cleanup) => log.warn("plugin candidate discard failed after install failure", cleanup));
          throw error;
        }
      }
    } catch (error) {
      log.error("plugin install failed", error);
      toast({ description: describePluginInstallFailure(error), variant: "destructive" });
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
      log.error("plugin uninstall failed", error);
      toast({ description: t("settings.uninstallFailed"), variant: "destructive" });
    }
  }

  async function handleBookAccessSubmit(id: string, grant: PluginBookAccess) {
    await updatePluginBookAccess(id, grant);
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
            const bookAccess = plugin.bookAccess ?? { mode: "all" as const };
            const bookAccessSource = plugin.bookAccessSource ?? "legacy-domain";
            return (
              <SettingsRow
                key={manifest.id}
                borderless={index === 0}
                title={
                  <span className="flex items-center gap-2">
                    <span>{manifest.name}</span>
                    <Caption className="text-fg-subtle">v{manifest.version}</Caption>
                    {plugin.builtin && <Badge className="text-[11px]">{t("settings.builtin")}</Badge>}
                  </span>
                }
                description={
                  <span className="flex flex-col gap-1.5">
                    {manifest.description && <span>{manifest.description}</span>}
                    <span className="flex flex-wrap items-center gap-1">
                      {permissions.length === 0 ? (
                        <Caption className="text-fg-subtle">{t("settings.noPermissions")}</Caption>
                      ) : (
                        permissions.map((permission: PluginPermission) => (
                          <Badge key={permission} className="text-[11px]">
                            {t(permissionNameKey(permission) as never)}
                          </Badge>
                        ))
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Caption className="text-fg-subtle">
                        {t("settings.bookAccess.summary", {
                          scope: t(`settings.bookAccess.${bookAccess.mode}` as never),
                        })}
                      </Caption>
                      {bookAccess.mode === "book" && (
                        <Caption className="text-fg-subtle">
                          {libraryBooks.find((book) => book.id === bookAccess.bookId)?.title ?? bookAccess.bookId}
                        </Caption>
                      )}
                      {bookAccessSource === "legacy-domain" && (
                        <Caption className="text-fg-subtle">{t("settings.bookAccess.legacy")}</Caption>
                      )}
                    </span>
                    {(manifest.schedules ?? []).map((schedule) => (
                      <Caption key={schedule.id} className="text-fg-subtle">
                        {t(schedule.mode === "deferred" ? "settings.deferredScheduleLine" : "settings.scheduleLine", {
                          label: schedule.label,
                          minutes: schedule.everyMinutes,
                        })}
                      </Caption>
                    ))}
                    {plugin.error && (
                      <PluginActivationError
                        error={plugin.error}
                        update={updateOffer(plugin)}
                        onCheckAppUpdate={() => setSectionRequest("about")}
                      />
                    )}
                  </span>
                }
                control={
                  <span className="flex shrink-0 items-center gap-2">
                    {plugin.enabled &&
                      (Boolean(manifest.settings?.length) ||
                        pluginPages.some((page) => page.pluginId === manifest.id)) && (
                        // Jump to the plugin's own settings section — the same
                        // sidebar entry, not a duplicate dialog. Disabled
                        // plugins have no section, so no button either.
                        <Button size="sm" variant="ghost" onClick={() => setSectionRequest(`plugin:${manifest.id}`)}>
                          {t("settings.configure")}
                        </Button>
                      )}
                    <Button size="sm" variant="ghost" onClick={() => setEditingBookAccessId(manifest.id)}>
                      {t("settings.bookAccess.change")}
                    </Button>
                    {!plugin.builtin && (
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
                    )}
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
    <SettingsPage headingRef={headingRef} title={t("settings.title")} description={t("settings.trustWarning")}>
      <Tabs
        ariaLabel={t("settings.title")}
        activeIndex={activeTab}
        onActiveIndexChange={setActiveTab}
        trailing={
          activeTab === 0 ? (
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={!desktop || installing} onClick={() => void handleInstall()}>
                {installing ? t("settings.installing") : t("settings.install")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!desktop || installing}
                onClick={() => void handleInstallZip()}
              >
                {t("settings.installZip")}
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setMarketRefreshToken((token) => token + 1)}>
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
      {(() => {
        const editing = editingBookAccessId
          ? installed.find((plugin) => plugin.manifest.id === editingBookAccessId)
          : undefined;
        if (!editing) return null;
        return (
          <PluginBookAccessDialog
            open
            pluginName={editing.manifest.name}
            grant={editing.bookAccess ?? { mode: "all" }}
            source={editing.bookAccessSource ?? "legacy-domain"}
            books={books}
            onClose={() => setEditingBookAccessId(null)}
            onSubmit={(next) => handleBookAccessSubmit(editing.manifest.id, next)}
          />
        );
      })()}
    </SettingsPage>
  );
}
