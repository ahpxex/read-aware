/**
 * Declarative plugin settings (manifest.settings): the app renders the form,
 * values persist as ONE object under the plugin's storage key `settings`
 * (plugins read `ctx.storage.get("settings")`). The Plugins panel opens this
 * as a Dialog via the standard view pipeline.
 */
import { emitAppEvent } from "../../../platform/app-events";
import { localKV } from "../../../platform/local-store";
import { getSettingsOptionsProvider } from "../state/plugin-store";
import type {
  InstalledPlugin,
  PluginFormField,
  PluginFormValues,
  PluginFormView,
  PluginManifest,
} from "./plugin-types";

function storageKey(pluginId: string): string {
  return `read-aware-plugin.${pluginId}.settings`;
}

export function readPluginSettingsValues(pluginId: string): PluginFormValues {
  try {
    const raw = localKV.getItem(storageKey(pluginId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as PluginFormValues) : {};
  } catch {
    return {};
  }
}

/** Build the settings form for a manifest, prefilled with stored values. */
export function buildPluginSettingsView(
  manifest: PluginManifest,
): PluginFormView | null {
  const fields = manifest.settings;
  if (!fields || fields.length === 0) return null;
  const stored = readPluginSettingsValues(manifest.id);
  return {
    kind: "form",
    title: manifest.name,
    submitMode: "change",
    fields: fields.map((field) => {
      const value = stored[field.id];
      if (field.kind === "toggle" || field.kind === "checkbox") {
        return { ...field, value: typeof value === "boolean" ? value : field.value };
      }
      if (field.kind === "number") {
        return { ...field, value: typeof value === "number" ? value : field.value };
      }
      return { ...field, value: typeof value === "string" ? value : field.value };
    }),
    onSubmit: (values) => {
      writePluginSettingsValues(manifest.id, values);
    },
    // Dynamic selects resolve through the source the plugin bound at
    // activate() (ctx.settings.provideOptions); an unbound field resolves
    // empty and renders as free text input.
    resolveOptions: (fieldId, values) =>
      getSettingsOptionsProvider(manifest.id, fieldId)?.resolve(values) ?? [],
  };
}

/** The one write path — the Plugins panel form and the agent both use it. */
export function writePluginSettingsValues(
  pluginId: string,
  values: PluginFormValues,
): void {
  localKV.setItem(storageKey(pluginId), JSON.stringify(values));
  // A running sandbox reads settings from its local snapshot; tell the
  // worker host so `ctx.storage.get("settings")` reflects this change.
  emitAppEvent("plugin-storage-changed", { pluginId });
}

export type AgentPluginSettings = {
  pluginId: string;
  pluginName: string;
  fields: PluginFormField[];
};

/**
 * The declared settings the agent may see: enabled plugins only, minus
 * password fields and anything the author marked `agentHidden`. Disabled
 * plugins keep their stored values but drop out of the catalog, mirroring
 * how their other contributions disappear.
 */
export function agentVisiblePluginSettings(
  plugins: InstalledPlugin[],
): AgentPluginSettings[] {
  return plugins
    .filter((plugin) => plugin.enabled && plugin.manifest.settings?.length)
    .map((plugin) => ({
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
      fields: (plugin.manifest.settings ?? []).filter(
        (field) =>
          !field.agentHidden &&
          !(field.kind === "text" && field.inputMode === "password"),
      ),
    }))
    .filter((plugin) => plugin.fields.length > 0);
}
