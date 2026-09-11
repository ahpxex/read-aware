import { AppError } from "@read-aware/core";
import type { PluginFormValues } from "@read-aware/plugin-types";
import { getDefaultStore } from "jotai";
import { i18n } from "../../i18n";
import { pluginSettingsKey } from "../../features/plugins/lib/plugin-settings";
import { installedPluginsAtom, getSettingsOptionsProvider } from "../../features/plugins/state/plugin-store";
import { localKV } from "../../platform/local-store";
import { settingsObservation } from "./observation-sources";

/** Only the owning provider receives its saved form values, never caller-supplied destinations. */
export function pluginOptionSource(path: string, networkAllowed: boolean) {
  const [, pluginId, fieldId] = path.split(".");
  const store = getDefaultStore();
  const installed = store.get(installedPluginsAtom).find(item => item.enabled && item.manifest.id === pluginId);
  const field = installed?.manifest.settings?.find(item => item.id === fieldId);
  if (!installed || !field || field.kind !== "select" || !field.dynamicOptions || field.agentHidden) {
    throw new AppError("settings/options-invalid", "No visible dynamic setting at this path");
  }
  if (installed.manifest.permissions?.includes("service:network") && !networkAllowed) {
    throw new AppError("settings/options-forbidden", "Resolving this plugin's options requires network authorization");
  }
  const provider = getSettingsOptionsProvider(pluginId!, fieldId!);
  if (!provider) throw new AppError("settings/options-unavailable", "Dynamic setting provider is not registered");
  const raw = localKV.getItem(pluginSettingsKey(pluginId!));
  let stored: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("Expected a settings object");
      stored = parsed as Record<string, unknown>;
    } catch (cause) { throw new AppError("db/error", "Plugin settings could not be read", { cause }); }
  }
  const values: PluginFormValues = {};
  for (const declared of installed.manifest.settings ?? []) {
    if (declared.kind === "secret" || declared.kind === "text" && declared.inputMode === "password") continue;
    const value = stored[declared.id] ?? declared.value;
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) {
      throw new AppError("db/error", "Invalid saved plugin setting value");
    }
    values[declared.id] = value;
  }
  const revision = settingsObservation.revision, locale = i18n.language;
  return {
    identity: provider, version: revision, pluginId: pluginId!, pluginName: installed.manifest.name,
    current: () => settingsObservation.revision === revision && i18n.language === locale &&
      store.get(installedPluginsAtom).find(item => item.enabled && item.manifest.id === pluginId) === installed &&
      getSettingsOptionsProvider(pluginId!, fieldId!) === provider,
    load: () => provider.resolve(structuredClone(values)),
  };
}
