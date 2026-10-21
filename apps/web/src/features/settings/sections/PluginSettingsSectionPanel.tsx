/**
 * One enabled plugin's settings section: its registered custom page or the
 * declarative form from its manifest, with any registered sync transport.
 */
import { useEffect, useMemo, useReducer, useSyncExternalStore } from "react";
import { InlineError } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { usePluginSettingsPage } from "../hooks/usePluginSettingsPage";
import { onAppEvent } from "../../../platform/app-events";
import { listSyncTransports, onSyncTransportsChanged } from "../../../platform/sync/transport-registry";
import { PluginViewRenderer } from "../../plugins/components/PluginViewRenderer";
import { buildPluginSettingsView } from "../../plugins/lib/plugin-settings";
import type { PluginManifest } from "../../plugins/lib/plugin-types";
import { SettingsPage } from "../components/SettingsPage";
import { TransportSyncGroup } from "./TransportSyncGroup";

export function PluginSettingsSectionPanel({ manifest }: { manifest: PluginManifest }) {
  const custom = usePluginSettingsPage(manifest.id);
  const { t } = useTranslation("plugins");
  // Rebuild the settings view when the plugin's storage changes — an agent
  // write or another surface editing the same settings must reach an open
  // form (which then adopts the fresh values for fields without a live
  // draft) instead of being shadowed by a mount-time snapshot.
  const [revision, bumpRevision] = useReducer((count: number) => count + 1, 0);
  useEffect(
    () =>
      onAppEvent("plugin-storage-changed", ({ pluginId }) => {
        if (pluginId === manifest.id) bumpRevision();
      }),
    [manifest.id],
  );

  // Stable identity per revision: the renderer resets its view stack (and
  // the form reconciles values) exactly when the view object changes.
  const view = useMemo(() => {
    const built = buildPluginSettingsView(manifest);
    return built ? { ...built, title: undefined } : null;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- revision invalidates the storage-backed values the builder reads
  }, [manifest, revision]);
  // A plugin that provides a sync backend (`sync:transport`) gets its whole
  // sync surface here — connect, status, sync now, disconnect — instead of
  // in Data & Sync. Registry-driven, so the group appears only while the
  // plugin's activation actually registered a transport.
  const providesTransport = useSyncExternalStore(
    onSyncTransportsChanged,
    () => listSyncTransports().some((transport) => transport.pluginId === manifest.id),
    () => false,
  );
  return (
    <SettingsPage title={manifest.name} description={manifest.description}>
      {custom.page ? (
        custom.failed ? (
          <InlineError>{t("viewer.liveFailed")}</InlineError>
        ) : (
          <PluginViewRenderer
            view={custom.view}
            onRequestRefresh={custom.refresh}
            onClose={custom.refresh}
            viewStateKey={`plugin-settings:${manifest.id}`}
            containerTitle={manifest.name}
            scroll="flow"
          />
        )
      ) : (
        view && (
          <PluginViewRenderer
            view={view}
            viewStateKey={`plugin-settings:${manifest.id}`}
            // The settings dialog's own viewport scrolls this panel.
            scroll="flow"
          />
        )
      )}
      {providesTransport && <TransportSyncGroup pluginId={manifest.id} />}
    </SettingsPage>
  );
}
