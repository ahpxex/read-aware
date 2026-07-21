/**
 * Declarative plugin settings (manifest.settings): the app renders the form,
 * values persist as ONE object under the plugin's storage key `settings`
 * (plugins read `ctx.storage.get("settings")`). The Plugins panel opens this
 * as a Dialog via the standard view pipeline.
 */
import { localKV } from "../../../platform/local-store";
import type {
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
  submitLabel: string,
  savedToast: string,
): PluginFormView | null {
  const fields = manifest.settings;
  if (!fields || fields.length === 0) return null;
  const stored = readPluginSettingsValues(manifest.id);
  return {
    kind: "form",
    title: manifest.name,
    fields: fields.map((field) => {
      const value = stored[field.id];
      if (field.kind === "toggle") {
        return { ...field, value: typeof value === "boolean" ? value : field.value };
      }
      if (field.kind === "number") {
        return { ...field, value: typeof value === "number" ? value : field.value };
      }
      return { ...field, value: typeof value === "string" ? value : field.value };
    }),
    submitLabel,
    onSubmit: (values) => {
      localKV.setItem(storageKey(manifest.id), JSON.stringify(values));
      return { close: true, toast: savedToast };
    },
  };
}
