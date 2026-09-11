import { AI_CONFIG_KEY, encodeAIConfig } from "../../features/ai/lib/ai-config";
import { MENU_CONFIG_KEY } from "../../features/menus/state/menu-config";
import { pluginSettingsKey } from "../../features/plugins/lib/plugin-settings";
import { APP_SETTINGS_KEY } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY } from "../../features/settings/lib/general-settings";
import { SHELF_VIEW_KEY } from "../../features/shelf/lib/shelf-view";
import { SHORTCUT_BINDINGS_KEY } from "../../features/settings/lib/shortcut-bindings";
import { AI_PREFERENCES_KEY } from "../../features/settings/lib/ai-preferences";
import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { setLocalKVBatch } from "../../platform/local-store";
import { CONTENT_TYPOGRAPHY_KEY } from "../../features/settings/lib/content-typography";
import { DEFAULT_COLOR_KEY } from "../../features/annotations/lib/annotation-prefs";
import { CHANNEL_KV_KEY } from "../../features/update/lib/update-channel";
import type { SettingsDraft } from "./catalog-runtime";
import type { EventOrigin } from "@read-aware/core";

/** Only validated catalog edits reach this host-owned transaction. Secrets are never written here. */
export function commitSettingsDraft(before: SettingsDraft, next: SettingsDraft, origin: EventOrigin, applyStartup = false): Promise<void> {
  const entries = new Map<string, string>();
  const record = (key: string, previous: unknown, value: unknown) => {
    const encoded = JSON.stringify(value);
    if (JSON.stringify(previous) !== encoded) entries.set(key, encoded);
  };
  record(GENERAL_SETTINGS_KEY, before.general, next.general);
  // The desired boolean can match SQLite while differing from OS registration.
  if (applyStartup) entries.set(GENERAL_SETTINGS_KEY, JSON.stringify(next.general));
  record(SHELF_VIEW_KEY, before.shelf, next.shelf);
  record(SHORTCUT_BINDINGS_KEY, before.shortcuts.bindings, next.shortcuts.bindings);
  record(APP_SETTINGS_KEY, before.appearance, next.appearance);
  record(READER_PREFERENCES_KEY, before.reading, next.reading);
  record(READER_OVERRIDES_KEY, before.readerOverrides, next.readerOverrides);
  record(CONTENT_TYPOGRAPHY_KEY, before.contentTypography, next.contentTypography);
  if (before.defaultMarkColor !== next.defaultMarkColor) entries.set(DEFAULT_COLOR_KEY, next.defaultMarkColor);
  if (before.updateChannel !== next.updateChannel) entries.set(CHANNEL_KV_KEY, next.updateChannel);
  record(AI_PREFERENCES_KEY, before.aiPreferences, next.aiPreferences);
  record(MENU_CONFIG_KEY, before.menus.config, next.menus.config);
  if (next.aiConfig && JSON.stringify(before.aiConfig) !== JSON.stringify(next.aiConfig)) {
    entries.set(AI_CONFIG_KEY, encodeAIConfig(next.aiConfig));
  }
  for (const [pluginId, values] of Object.entries(next.pluginSettings.values)) {
    record(pluginSettingsKey(pluginId), before.pluginSettings.values[pluginId], values);
  }
  // Domain commands return the exact failure to their UI, Agent or Worker owner.
  return setLocalKVBatch(entries, origin, "local", "caller");
}
