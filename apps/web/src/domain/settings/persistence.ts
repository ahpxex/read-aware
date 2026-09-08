import { AI_CONFIG_KEY, encodeAIConfig } from "../../features/ai/lib/ai-config";
import { MENU_CONFIG_KEY } from "../../features/menus/state/menu-config";
import { pluginSettingsKey } from "../../features/plugins/lib/plugin-settings";
import { APP_SETTINGS_KEY } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY } from "../../features/settings/lib/general-settings";
import { AI_PREFERENCES_KEY } from "../../features/settings/lib/ai-preferences";
import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { setLocalKVBatch } from "../../platform/local-store";
import type { SettingsDraft } from "./catalog-runtime";

/** Only validated catalog edits reach this host-owned transaction. Secrets are never written here. */
export function commitSettingsDraft(before: SettingsDraft, next: SettingsDraft): Promise<void> {
  const entries = new Map<string, string>();
  const record = (key: string, previous: unknown, value: unknown) => {
    const encoded = JSON.stringify(value);
    if (JSON.stringify(previous) !== encoded) entries.set(key, encoded);
  };
  record(GENERAL_SETTINGS_KEY, before.general, next.general);
  record(APP_SETTINGS_KEY, before.appearance, next.appearance);
  record(READER_PREFERENCES_KEY, before.reading, next.reading);
  record(READER_OVERRIDES_KEY, before.readerOverrides, next.readerOverrides);
  record(AI_PREFERENCES_KEY, before.aiPreferences, next.aiPreferences);
  record(MENU_CONFIG_KEY, before.menus.config, next.menus.config);
  if (next.aiConfig && JSON.stringify(before.aiConfig) !== JSON.stringify(next.aiConfig)) {
    entries.set(AI_CONFIG_KEY, encodeAIConfig(next.aiConfig));
  }
  for (const [pluginId, values] of Object.entries(next.pluginSettings.values)) {
    record(pluginSettingsKey(pluginId), before.pluginSettings.values[pluginId], values);
  }
  return setLocalKVBatch(entries);
}
