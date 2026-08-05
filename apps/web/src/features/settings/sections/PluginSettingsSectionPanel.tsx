/**
 * One enabled plugin's declared settings as a first-class settings section —
 * the same form the Plugins-panel dialog shows, rendered inline. The section
 * exists only while the plugin is enabled and declares settings.
 */
import { useEffect, useMemo, useReducer } from "react";
import { onAppEvent } from "../../../platform/app-events";
import { PluginViewRenderer } from "../../plugins/components/PluginViewRenderer";
import { buildPluginSettingsView } from "../../plugins/lib/plugin-settings";
import type { PluginManifest } from "../../plugins/lib/plugin-types";
import { SettingsPage } from "../components/SettingsPage";

export function PluginSettingsSectionPanel({
  manifest,
}: {
  manifest: PluginManifest;
}) {
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
  }, [manifest, revision]);
  return (
    <SettingsPage title={manifest.name} description={manifest.description}>
      {view && (
        <PluginViewRenderer
          view={view}
          viewStateKey={`plugin-settings:${manifest.id}`}
          // The settings dialog's own viewport scrolls this panel.
          scroll="flow"
        />
      )}
    </SettingsPage>
  );
}
