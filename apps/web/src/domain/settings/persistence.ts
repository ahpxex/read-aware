import type { DomainActor } from "../../platform/domain-actor";
import { AI_CONFIG_KEY, encodeAIConfig } from "../../features/ai/lib/ai-config";
import { MENU_CONFIG_KEY } from "../../features/menus/state/menu-config";
import { pluginSettingsKey } from "../../features/plugins/lib/plugin-settings";
import { APP_SETTINGS_KEY } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY } from "../../features/settings/lib/general-settings";
import { SHELF_VIEW_KEY } from "../../features/shelf/lib/shelf-view";
import { PAGE_TURN_SETTINGS_KEY } from "./page-turn-settings";
import { HEADER_FOOTER_SETTINGS_KEY } from "./header-footer-settings";
import { SHORTCUT_BINDINGS_KEY } from "../../features/settings/lib/shortcut-bindings";
import { AI_PREFERENCES_KEY } from "../../features/settings/lib/ai-preferences";
import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { READER_LANGUAGES_KEY } from "../../features/settings/lib/reader-languages";
import { setLocalKVBatch } from "../../platform/local-store";
import { CONTENT_TYPOGRAPHY_KEY } from "../../features/settings/lib/content-typography";
import { DEFAULT_COLOR_KEY } from "../../features/annotations/lib/annotation-prefs";
import { CHANNEL_KV_KEY } from "../../features/update/lib/update-channel";
import type { SettingsDraft } from "./catalog-runtime";
import { AppError, type SettingsQueryTarget } from "@read-aware/core";
import type { SettingsDomain } from "./domain";

/** Validate against the caller's live catalog before resolving private storage
 * namespaces. These keys must never be accepted from or returned to a caller. */
export async function settingsChangeKeys(
  domain: SettingsDomain,
  paths: readonly string[],
  bookId?: string,
): Promise<string[]> {
  const target: SettingsQueryTarget = bookId ? { kind: "book", bookId } : { kind: "global" };
  const keys = new Set<string>();
  for (const path of paths) {
    await domain.queries.read(path, target);
    let key: string | undefined;
    if (path === "general.updateChannel") key = CHANNEL_KV_KEY;
    else if (path.startsWith("general.")) key = GENERAL_SETTINGS_KEY;
    else if (path.startsWith("appearance.contentTypography.")) key = CONTENT_TYPOGRAPHY_KEY;
    else if (path.startsWith("appearance.")) key = APP_SETTINGS_KEY;
    else if (path === "annotations.defaultColor") key = DEFAULT_COLOR_KEY;
    else if (path.startsWith("shelf.")) key = SHELF_VIEW_KEY;
    else if (path.startsWith("shortcuts.")) key = SHORTCUT_BINDINGS_KEY;
    else if (path.startsWith("reading.pageTurn.")) key = PAGE_TURN_SETTINGS_KEY;
    else if (path.startsWith("reading.headerFooter.")) key = HEADER_FOOTER_SETTINGS_KEY;
    else if (path.startsWith("reading.")) {
      key = READER_PREFERENCES_KEY;
      if (bookId) {
        keys.add(READER_OVERRIDES_KEY);
        keys.add(READER_LANGUAGES_KEY);
      }
    } else if (path.startsWith("ai.preferences.")) key = AI_PREFERENCES_KEY;
    else if (path.startsWith("ai.connection.")) key = AI_CONFIG_KEY;
    else if (path.startsWith("menus.")) key = MENU_CONFIG_KEY;
    else if (/^plugins\.[^.]+\.[^.]+$/.test(path)) key = pluginSettingsKey(path.split(".")[1]!);
    if (!key) throw new AppError("changes/invalid-query", "Setting has no persistent change source");
    keys.add(key);
  }
  return [...keys].sort();
}

/** Only validated catalog edits reach this host-owned transaction. Secrets are never written here. */
export function settingsDraftEntries(
  before: SettingsDraft,
  next: SettingsDraft,
  applyStartup = false,
): Map<string, string> {
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
  record(PAGE_TURN_SETTINGS_KEY, before.pageTurn, next.pageTurn);
  record(HEADER_FOOTER_SETTINGS_KEY, before.headerFooter, next.headerFooter);
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
  return entries;
}

/** Domain commands return the exact failure to their UI, Agent or Worker owner. */
export function commitSettingsDraft(
  before: SettingsDraft,
  next: SettingsDraft,
  origin: DomainActor,
  applyStartup = false,
): Promise<void> {
  return setLocalKVBatch(settingsDraftEntries(before, next, applyStartup), origin, "local", "caller");
}
