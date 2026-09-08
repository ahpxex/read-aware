/**
 * Declarative plugin settings (manifest.settings): the app renders the form,
 * values persist as ONE object under the plugin's storage key `settings`
 * (plugins read `ctx.services.storage.get("settings")`). The Plugins panel opens this
 * as a Dialog via the standard view pipeline.
 */
import { emitAppEvent } from "../../../platform/app-events";
import { localKV, onLocalKVChange } from "../../../platform/local-store";
import {
  deletePluginSecret,
  getPluginSecret,
  setPluginSecret,
} from "../../../platform/secret-store";
import { getSettingsOptionsProvider } from "../state/plugin-store";
import type {
  InstalledPlugin,
  PluginFormField,
  PluginFormValues,
  PluginFormView,
  PluginManifest,
} from "./plugin-types";

export function pluginSettingsKey(pluginId: string): string {
  return `read-aware-plugin.${pluginId}.settings`;
}

// Invalidate from the actual overlay, including failed-write rollback. Defer
// until all KV observers have run so Worker mirrors precede provider callbacks.
const pendingInvalidations = new Set<string>();
onLocalKVChange((key) => {
  const prefix = "read-aware-plugin.";
  const suffix = ".settings";
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
  const pluginId = key.slice(prefix.length, -suffix.length);
  if (pendingInvalidations.has(pluginId)) return;
  pendingInvalidations.add(pluginId);
  queueMicrotask(() => {
    pendingInvalidations.delete(pluginId);
    emitAppEvent("plugin-storage-changed", { pluginId });
  });
});

export function readPluginSettingsValues(pluginId: string): PluginFormValues {
  try {
    const raw = localKV.getItem(pluginSettingsKey(pluginId));
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
      // A secret field carries no value — it lives in the secret store, not
      // in the settings object, and is never echoed back.
      if (field.kind === "secret") return { ...field };
      const value = stored[field.id];
      if (field.kind === "toggle" || field.kind === "checkbox") {
        return { ...field, value: typeof value === "boolean" ? value : field.value };
      }
      if (field.kind === "number") {
        return { ...field, value: typeof value === "number" ? value : field.value };
      }
      return { ...field, value: typeof value === "string" ? value : field.value };
    }),
    onSubmit: (values) => writePluginSettingsValues(manifest.id, values),
    // Dynamic selects resolve through the source the plugin bound at
    // activate() (ctx.contributions.settingsOptions.register); an unbound field resolves
    // empty and renders as free text input.
    resolveOptions: (fieldId, values) =>
      getSettingsOptionsProvider(manifest.id, fieldId)?.resolve(values) ?? [],
    // Secret fields write straight to the plugin's encrypted secret
    // namespace — the same store ctx.secrets reads on the plugin side.
    secrets: {
      has: async (id) => {
        const value = await getPluginSecret(manifest.id, id);
        return value != null && value !== "";
      },
      set: (id, value) => setPluginSecret(manifest.id, id, value),
      remove: (id) => deletePluginSecret(manifest.id, id),
    },
  };
}

/** Declarative form writes return their exact durability receipt. */
export function writePluginSettingsValues(
  pluginId: string,
  values: PluginFormValues,
): Promise<void> {
  return localKV.setItemAsync(pluginSettingsKey(pluginId), JSON.stringify(values));
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
          field.kind !== "secret" &&
          !(field.kind === "text" && field.inputMode === "password"),
      ),
    }))
    .filter((plugin) => plugin.fields.length > 0);
}
