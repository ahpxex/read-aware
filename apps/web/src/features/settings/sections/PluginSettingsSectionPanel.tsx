/**
 * One enabled plugin's declared settings as a first-class settings section —
 * the same form the Plugins-panel dialog shows, rendered inline. The section
 * exists only while the plugin is enabled and declares settings.
 */
import { PluginViewRenderer } from "../../plugins/components/PluginViewRenderer";
import { buildPluginSettingsView } from "../../plugins/lib/plugin-settings";
import type { PluginManifest } from "../../plugins/lib/plugin-types";
import { SettingsPage } from "../components/SettingsPage";

export function PluginSettingsSectionPanel({
  manifest,
}: {
  manifest: PluginManifest;
}) {
  const view = buildPluginSettingsView(manifest);
  return (
    <SettingsPage title={manifest.name} description={manifest.description}>
      {view && (
        <PluginViewRenderer
          view={{ ...view, title: undefined }}
          viewStateKey={`plugin-settings:${manifest.id}`}
          // The settings dialog's own viewport scrolls this panel.
          scroll="flow"
        />
      )}
    </SettingsPage>
  );
}
